// @flow

// TODO: Add default fields recursively
// TODO: Add default fields for all selections (not just fragments)
// TODO: Custom default args
// TODO: Add stylesheet and remove inline styles
// TODO: Indication of when query in explorer diverges from query in editor pane
// TODO: Show "No Schema Available" when schema is empty
// TODO: Separate section for deprecated args, with support for 'beta' fields

import React from 'react';

import {
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isLeafType,
  isNonNullType,
  isObjectType,
  isRequiredInputField,
  isScalarType,
  isUnionType,
  isWrappingType,
  parse,
  print,
} from 'graphql';

import type {
  ArgumentNode,
  DocumentNode,
  FieldNode,
  GraphQLArgument,
  GraphQLEnumType,
  GraphQLField,
  GraphQLFieldMap,
  GraphQLInputField,
  GraphQLInputType,
  GraphQLObjectType,
  GraphQLOutputType,
  GraphQLScalarType,
  GraphQLSchema,
  InlineFragmentNode,
  OperationDefinitionNode,
  ObjectFieldNode,
  ObjectValueNode,
  SelectionNode,
  ValueNode,
} from 'graphql';

type Props = {
  query: string,
  width?: number,
  schema?: ?GraphQLSchema,
  onEdit: string => void,
  getDefaultFieldNames?: ?(type: GraphQLObjectType) => Array<string>,
  onToggleExplorer: () => void,
  explorerIsOpen: boolean,
};

type State = {
  operation: OperationDefinitionNode,
};

type Field = GraphQLField<any, any>;

type Selections = $ReadOnlyArray<SelectionNode>;

function defaultGetDefaultFieldNames(type: GraphQLObjectType): Array<string> {
  const fields = type.getFields();

  // Is there an `id` field?
  if (fields['id']) {
    let res = ['id'];
    if (fields['email']) {
      res.push('email');
    } else if (fields['name']) {
      res.push('name');
    }
    return res;
  }

  // Is there an `edges` field?
  if (fields['edges']) {
    return ['edges'];
  }

  // Is there an `node` field?
  if (fields['node']) {
    return ['node'];
  }

  if (fields['nodes']) {
    return ['nodes'];
  }

  // Include all leaf-type fields.
  const leafFieldNames = [];
  Object.keys(fields).forEach(fieldName => {
    if (isLeafType(fields[fieldName].type)) {
      leafFieldNames.push(fieldName);
    }
  });
  return leafFieldNames.slice(0, 2); // Prevent too many fields from being added
}

function isRequiredArgument(arg: GraphQLArgument): boolean %checks {
  return isNonNullType(arg.type) && arg.defaultValue === undefined;
}

function unwrapOutputType(outputType: GraphQLOutputType): GraphQLOutputType {
  let unwrappedType = outputType;
  while (isWrappingType(unwrappedType)) {
    unwrappedType = unwrappedType.ofType;
  }
  return unwrappedType;
}

function unwrapInputType(inputType: GraphQLInputType): GraphQLInputType {
  let unwrappedType = inputType;
  while (isWrappingType(unwrappedType)) {
    unwrappedType = unwrappedType.ofType;
  }
  return unwrappedType;
}

function argValue(
  argType: GraphQLScalarType | GraphQLEnumType,
  value: string,
): ValueNode {
  if (isScalarType(argType)) {
    try {
      switch (argType.name) {
        case 'String':
          return {
            kind: 'StringValue',
            value: String(argType.parseValue(value)),
          };
        case 'Float':
          return {kind: 'FloatValue', value: String(argType.parseValue(value))};
        case 'Int':
          return {kind: 'IntValue', value: String(argType.parseValue(value))};
        case 'Boolean':
          try {
            const parsed = JSON.parse(value);
            if (typeof parsed === 'boolean') {
              return {kind: 'BooleanValue', value: parsed};
            } else {
              return {kind: 'BooleanValue', value: false};
            }
          } catch (e) {
            return {
              kind: 'BooleanValue',
              value: false,
            };
          }
        default:
          return {
            kind: 'StringValue',
            value: String(argType.parseValue(value)),
          };
      }
    } catch (e) {
      return {kind: 'StringValue', value: value};
    }
  } else {
    try {
      const parsedValue = argType.parseValue(value);
      if (parsedValue) {
        return {kind: 'EnumValue', value: String(parsedValue)};
      } else {
        return {kind: 'EnumValue', value: argType.getValues()[0].name};
      }
    } catch (e) {
      return {kind: 'EnumValue', value: argType.getValues()[0].name};
    }
  }
}

type InputArgViewProps = {
  arg: GraphQLArgument,
  selection: ObjectValueNode,
  modifyFields: (fields: $ReadOnlyArray<ObjectFieldNode>) => void,
};

class InputArgView extends React.PureComponent<InputArgViewProps, {}> {
  _previousArgSelection: ?ObjectFieldNode;
  _getArgSelection = () => {
    return this.props.selection.fields.find(
      field => field.name.value === this.props.arg.name,
    );
  };

  _removeArg = () => {
    const {selection} = this.props;
    const argSelection = this._getArgSelection();
    this._previousArgSelection = argSelection;
    this.props.modifyFields(
      selection.fields.filter(field => field !== argSelection),
    );
  };

  _addArg = () => {
    const {selection} = this.props;
    const argType = unwrapInputType(this.props.arg.type);

    let argSelection = null;
    if (this._previousArgSelection) {
      argSelection = this._previousArgSelection;
    } else if (isInputObjectType(argType)) {
      const fields = argType.getFields();
      argSelection = {
        kind: 'ObjectField',
        name: {kind: 'Name', value: this.props.arg.name},
        value: {
          kind: 'ObjectValue',
          fields: defaultInputObjectFields(
            Object.keys(fields).map(k => fields[k]),
          ),
        },
      };
    } else if (isLeafType(argType)) {
      argSelection = {
        kind: 'ObjectField',
        name: {kind: 'Name', value: this.props.arg.name},
        value: defaultValue(argType),
      };
    }

    if (!argSelection) {
      console.error('Unable to add arg for argType', argType);
    } else {
      this.props.modifyFields([...(selection.fields || []), argSelection]);
    }
  };

  _setArgValue = event => {
    const {selection} = this.props;
    const argSelection = this._getArgSelection();
    if (!argSelection) {
      console.error('missing arg selection when setting arg value');
      return;
    }
    const argType = unwrapInputType(this.props.arg.type);
    if (!isLeafType(argType)) {
      console.warn('Unable to handle non leaf types in setArgValue');
      return;
    }
    const targetValue = event.target.value;

    this.props.modifyFields(
      (selection.fields || []).map(field =>
        field === argSelection
          ? {
              ...field,
              value: argValue(argType, targetValue),
            }
          : field,
      ),
    );
  };

  _modifyChildFields = fields => {
    this.props.modifyFields(
      this.props.selection.fields.map(field =>
        field.name.value === this.props.arg.name
          ? {
              ...field,
              value: {
                kind: 'ObjectValue',
                fields: fields,
              },
            }
          : field,
      ),
    );
  };

  render() {
    const {arg} = this.props;
    const argSelection = this._getArgSelection();

    return (
      <AbstractArgView
        argValue={argSelection ? argSelection.value : null}
        arg={arg}
        addArg={this._addArg}
        removeArg={this._removeArg}
        setArgFields={this._modifyChildFields}
        setArgValue={this._setArgValue}
      />
    );
  }
}

type ArgViewProps = {
  arg: GraphQLArgument,
  selection: FieldNode,
  modifyArguments: (argumentNodes: $ReadOnlyArray<ArgumentNode>) => void,
};

type ArgViewState = {};

function defaultValue(argType: GraphQLEnumType | GraphQLScalarType): ValueNode {
  if (isEnumType(argType)) {
    return {kind: 'EnumValue', value: argType.getValues()[0].name};
  } else {
    switch (argType.name) {
      case 'String':
        return {kind: 'StringValue', value: ''};
      case 'Float':
        return {kind: 'FloatValue', value: '1.5'};
      case 'Int':
        return {kind: 'IntValue', value: '10'};
      case 'Boolean':
        return {kind: 'BooleanValue', value: false};
      default:
        return {kind: 'StringValue', value: ''};
    }
  }
}

class ArgView extends React.PureComponent<ArgViewProps, ArgViewState> {
  _previousArgSelection: ?ArgumentNode;
  _getArgSelection = () => {
    const {selection} = this.props;

    return (selection.arguments || []).find(
      arg => arg.name.value === this.props.arg.name,
    );
  };
  _removeArg = () => {
    const {selection} = this.props;
    const argSelection = this._getArgSelection();
    this._previousArgSelection = argSelection;
    this.props.modifyArguments(
      (selection.arguments || []).filter(arg => arg !== argSelection),
    );
  };
  _addArg = () => {
    const {selection} = this.props;
    const argType = unwrapInputType(this.props.arg.type);

    let argSelection = null;
    if (this._previousArgSelection) {
      argSelection = this._previousArgSelection;
    } else if (isInputObjectType(argType)) {
      const fields = argType.getFields();
      argSelection = {
        kind: 'Argument',
        name: {kind: 'Name', value: this.props.arg.name},
        value: {
          kind: 'ObjectValue',
          fields: defaultInputObjectFields(
            Object.keys(fields).map(k => fields[k]),
          ),
        },
      };
    } else if (isLeafType(argType)) {
      argSelection = {
        kind: 'Argument',
        name: {kind: 'Name', value: this.props.arg.name},
        value: defaultValue(argType),
      };
    }

    if (!argSelection) {
      console.error('Unable to add arg for argType', argType);
    } else {
      this.props.modifyArguments([
        ...(selection.arguments || []),
        argSelection,
      ]);
    }
  };
  _setArgValue = event => {
    const {selection} = this.props;
    const argSelection = this._getArgSelection();
    if (!argSelection) {
      console.error('missing arg selection when setting arg value');
      return;
    }
    const argType = unwrapInputType(this.props.arg.type);
    if (!isLeafType(argType)) {
      console.warn('Unable to handle non leaf types in setArgValue');
      return;
    }

    const targetValue = event.target.value;

    this.props.modifyArguments(
      (selection.arguments || []).map(a =>
        a === argSelection
          ? {
              ...a,
              value: argValue(argType, targetValue),
            }
          : a,
      ),
    );
  };

  _setArgFields = fields => {
    const {selection} = this.props;
    const argSelection = this._getArgSelection();
    if (!argSelection) {
      console.error('missing arg selection when setting arg value');
      return;
    }

    this.props.modifyArguments(
      (selection.arguments || []).map(a =>
        a === argSelection
          ? {
              ...a,
              value: {
                kind: 'ObjectValue',
                fields,
              },
            }
          : a,
      ),
    );
  };

  render() {
    const {arg} = this.props;
    const argSelection = this._getArgSelection();

    return (
      <AbstractArgView
        argValue={argSelection ? argSelection.value : null}
        arg={arg}
        addArg={this._addArg}
        removeArg={this._removeArg}
        setArgFields={this._setArgFields}
        setArgValue={this._setArgValue}
      />
    );
  }
}

type AbstractArgViewProps = {
  argValue: ?ValueNode,
  arg: GraphQLArgument,
  setArgValue: (event: SyntheticInputEvent<*>) => void,
  setArgFields: (fields: $ReadOnlyArray<ObjectFieldNode>) => void,
  addArg: () => void,
  removeArg: () => void,
};

type ScalarInputProps = {
  arg: GraphQLArgument,
  argValue: ValueNode,
  setArgValue: (event: SyntheticInputEvent<*>) => void,
};

class ScalarInput extends React.PureComponent<ScalarInputProps, {}> {
  _ref: ?any;
  _handleChange = event => {
    this.props.setArgValue(event);
  };

  componentDidMount() {
    const input = this._ref;
    const activeElement = document.activeElement;
    if (
      input &&
      activeElement &&
      !(activeElement instanceof HTMLTextAreaElement)
    ) {
      input.focus();
    }
  }
  render() {
    const {arg, argValue} = this.props;
    const argType = unwrapInputType(arg.type);
    const color =
      this.props.argValue.kind === 'StringValue' ? '#D64292' : '#2882F9';
    const value = typeof argValue.value === 'string' ? argValue.value : '';
    return (
      <span style={{color}}>
        {argType.name === 'String' ? '"' : ''}
        <input
          style={{
            border: 'none',
            borderBottom: '1px solid #888',
            outline: 'none',
            color,
            width: `${Math.max(1, value.length)}ch`,
          }}
          ref={ref => {
            this._ref = ref;
          }}
          type="text"
          onChange={this._handleChange}
          value={value}
        />
        {argType.name === 'String' ? '"' : ''}
      </span>
    );
  }
}

class AbstractArgView extends React.PureComponent<AbstractArgViewProps, {}> {
  render() {
    const {argValue, arg} = this.props;
    // TODO: handle List types
    const argType = unwrapInputType(arg.type);

    let input = null;
    if (argValue) {
      if (argValue.kind === 'Variable') {
        input = <span style={{color: '#397D13'}}>${argValue.name.value}</span>;
      } else if (isScalarType(argType)) {
        if (argType.name === 'Boolean') {
          input = (
            <select
              style={{backgroundColor: 'white', color: '#D47509'}}
              onChange={this.props.setArgValue}
              value={
                argValue.kind === 'BooleanValue' ? argValue.value : undefined
              }>
              <option key="true" value="true">
                true
              </option>
              <option key="false" value="false">
                false
              </option>
            </select>
          );
        } else {
          input = (
            <ScalarInput
              setArgValue={this.props.setArgValue}
              arg={arg}
              argValue={argValue}
            />
          );
        }
      } else if (isEnumType(argType)) {
        if (argValue.kind === 'EnumValue') {
          input = (
            <select
              style={{backgroundColor: 'white', color: '#0B7FC7'}}
              onChange={this.props.setArgValue}
              value={argValue.value}>
              {argType.getValues().map(value => (
                <option key={value.name} value={value.name}>
                  {value.name}
                </option>
              ))}
            </select>
          );
        } else {
          console.error(
            'arg mismatch between arg and selection',
            argType,
            argValue,
          );
        }
      } else if (isInputObjectType(argType)) {
        if (argValue.kind === 'ObjectValue') {
          const fields = argType.getFields();
          input = (
            <div style={{marginLeft: 16}}>
              {Object.keys(fields).map(fieldName => (
                <InputArgView
                  key={fieldName}
                  arg={fields[fieldName]}
                  selection={argValue}
                  modifyFields={this.props.setArgFields}
                />
              ))}
            </div>
          );
        } else {
          console.error(
            'arg mismatch between arg and selection',
            argType,
            argValue,
          );
        }
      }
    }

    return (
      <div>
        <span
          style={{cursor: 'pointer'}}
          onClick={argValue ? this.props.removeArg : this.props.addArg}>
          <input readOnly type="checkbox" checked={!!argValue} />
          <span title={arg.description} style={{color: '#8B2BB9'}}>
            {arg.name}
            {isRequiredArgument(arg) ? '*' : ''}:
          </span>
        </span>{' '}
        {input}
      </div>
    );
  }
}

type AbstractViewProps = {
  implementingType: GraphQLObjectType,
  selections: Selections,
  modifySelections: (selections: Selections) => void,
  schema: GraphQLSchema,
  getDefaultFieldNames: (type: GraphQLObjectType) => Array<string>,
};

class AbstractView extends React.PureComponent<AbstractViewProps, {}> {
  _previousSelection: ?InlineFragmentNode;
  _addFragment = () => {
    this.props.modifySelections([
      ...this.props.selections,
      this._previousSelection || {
        kind: 'InlineFragment',
        typeCondition: {
          kind: 'NamedType',
          name: {kind: 'Name', value: this.props.implementingType.name},
        },
        selectionSet: {
          kind: 'SelectionSet',
          selections: this.props
            .getDefaultFieldNames(this.props.implementingType)
            .map(fieldName => ({
              kind: 'Field',
              name: {kind: 'Name', value: fieldName},
            })),
        },
      },
    ]);
  };
  _removeFragment = () => {
    const thisSelection = this._getSelection();
    this._previousSelection = thisSelection;
    this.props.modifySelections(
      this.props.selections.filter(s => s !== thisSelection),
    );
  };
  _getSelection = (): ?InlineFragmentNode => {
    const selection = this.props.selections.find(
      selection =>
        selection.kind === 'InlineFragment' &&
        selection.typeCondition &&
        this.props.implementingType.name === selection.typeCondition.name.value,
    );
    if (!selection) {
      return null;
    }
    if (selection.kind === 'InlineFragment') {
      return selection;
    }
  };

  _modifyChildSelections = (selections: Selections) => {
    const thisSelection = this._getSelection();
    this.props.modifySelections(
      this.props.selections.map(selection => {
        if (selection === thisSelection) {
          return {
            directives: selection.directives,
            kind: 'InlineFragment',
            typeCondition: {
              kind: 'NamedType',
              name: {kind: 'Name', value: this.props.implementingType.name},
            },
            selectionSet: {
              kind: 'SelectionSet',
              selections,
            },
          };
        }
        return selection;
      }),
    );
  };

  render() {
    const {implementingType, schema, getDefaultFieldNames} = this.props;
    const selection = this._getSelection();
    const fields = implementingType.getFields();
    const childSelections = selection
      ? selection.selectionSet
        ? selection.selectionSet.selections
        : []
      : [];
    return (
      <div>
        <span
          style={{cursor: 'pointer'}}
          onClick={selection ? this._removeFragment : this._addFragment}>
          <input readOnly type="checkbox" checked={!!selection} />
          <span style={{color: '#CA9800'}}>
            {this.props.implementingType.name}
          </span>
        </span>
        {selection ? (
          <div style={{marginLeft: 16}}>
            {Object.keys(fields)
              .sort()
              .map(fieldName => (
                <FieldView
                  key={fieldName}
                  field={fields[fieldName]}
                  selections={childSelections}
                  modifySelections={this._modifyChildSelections}
                  schema={schema}
                  getDefaultFieldNames={getDefaultFieldNames}
                />
              ))}
          </div>
        ) : null}
      </div>
    );
  }
}

type FieldViewProps = {
  field: Field,
  selections: Selections,
  modifySelections: (selections: Selections) => void,
  schema: GraphQLSchema,
  getDefaultFieldNames: (type: GraphQLObjectType) => Array<string>,
};

function defaultInputObjectFields(
  fields: Array<GraphQLInputField>,
): Array<ObjectFieldNode> {
  const nodes = [];
  for (const field of fields) {
    if (isRequiredInputField(field)) {
      const fieldType = unwrapInputType(field.type);
      if (isInputObjectType(fieldType)) {
        const fields = fieldType.getFields();
        nodes.push({
          kind: 'ObjectField',
          name: {kind: 'Name', value: field.name},
          value: {
            kind: 'ObjectValue',
            fields: defaultInputObjectFields(
              Object.keys(fields).map(k => fields[k]),
            ),
          },
        });
      } else if (isLeafType(fieldType)) {
        nodes.push({
          kind: 'ObjectField',
          name: {kind: 'Name', value: field.name},
          value: defaultValue(fieldType),
        });
      }
    }
  }
  return nodes;
}

function defaultArgs(field: Field): Array<ArgumentNode> {
  const args = [];
  for (const arg of field.args) {
    if (isRequiredArgument(arg)) {
      const argType = unwrapInputType(arg.type);
      if (isInputObjectType(argType)) {
        const fields = argType.getFields();
        args.push({
          kind: 'Argument',
          name: {kind: 'Name', value: arg.name},
          value: {
            kind: 'ObjectValue',
            fields: defaultInputObjectFields(
              Object.keys(fields).map(k => fields[k]),
            ),
          },
        });
      } else if (isLeafType(argType)) {
        args.push({
          kind: 'Argument',
          name: {kind: 'Name', value: arg.name},
          value: defaultValue(argType),
        });
      }
    }
  }
  return args;
}

class FieldView extends React.PureComponent<FieldViewProps, {}> {
  _previousSelection: ?SelectionNode;
  _addFieldToSelections = () =>
    this.props.modifySelections([
      ...this.props.selections,
      this._previousSelection || {
        kind: 'Field',
        name: {kind: 'Name', value: this.props.field.name},
        arguments: defaultArgs(this.props.field),
      },
    ]);

  _removeFieldFromSelections = () => {
    const previousSelection = this._getSelection();
    this._previousSelection = previousSelection;
    this.props.modifySelections(
      this.props.selections.filter(
        selection => selection !== previousSelection,
      ),
    );
  };
  _getSelection = (): ?FieldNode => {
    const selection = this.props.selections.find(
      selection =>
        selection.kind === 'Field' &&
        this.props.field.name === selection.name.value,
    );
    if (!selection) {
      return null;
    }
    if (selection.kind === 'Field') {
      return selection;
    }
  };

  _setArguments = (argumentNodes: $ReadOnlyArray<ArgumentNode>) => {
    const selection = this._getSelection();
    if (!selection) {
      console.error('Missing selection when setting arguments', argumentNodes);
      return;
    }
    this.props.modifySelections(
      this.props.selections.map(s =>
        s === selection
          ? {
              alias: selection.alias,
              arguments: argumentNodes,
              directives: selection.directives,
              kind: 'Field',
              name: selection.name,
              selectionSet: selection.selectionSet,
            }
          : s,
      ),
    );
  };

  _modifyChildSelections = (selections: Selections) => {
    this.props.modifySelections(
      this.props.selections.map(selection => {
        if (
          selection.kind === 'Field' &&
          this.props.field.name === selection.name.value
        ) {
          if (selection.kind !== 'Field') {
            throw new Error('invalid selection');
          }
          return {
            alias: selection.alias,
            arguments: selection.arguments,
            directives: selection.directives,
            kind: 'Field',
            name: selection.name,
            selectionSet: {
              kind: 'SelectionSet',
              selections,
            },
          };
        }
        return selection;
      }),
    );
  };

  render() {
    const {field, schema, getDefaultFieldNames} = this.props;
    const selection = this._getSelection();
    const type = unwrapOutputType(field.type);
    const args = field.args;
    const node = (
      <div className="graphiql-explorer-node">
        <span
          title={field.description}
          style={{cursor: 'pointer'}}
          onClick={
            selection
              ? this._removeFieldFromSelections
              : this._addFieldToSelections
          }>
          <input readOnly type="checkbox" checked={!!selection} />
          <span style={{color: 'rgb(31, 97, 160)'}}>{field.name}</span>
        </span>
        {selection && args.length ? (
          <div style={{marginLeft: 16}}>
            {args.map(arg => (
              <ArgView
                key={arg.name}
                arg={arg}
                selection={selection}
                modifyArguments={this._setArguments}
              />
            ))}
          </div>
        ) : null}
      </div>
    );

    if (
      selection &&
      (isObjectType(type) || isInterfaceType(type) || isUnionType(type))
    ) {
      const fields = isUnionType(type) ? {} : type.getFields();
      const childSelections = selection
        ? selection.selectionSet
          ? selection.selectionSet.selections
          : []
        : [];
      return (
        <div>
          {node}
          <div style={{marginLeft: 16}}>
            {Object.keys(fields)
              .sort()
              .map(fieldName => (
                <FieldView
                  key={fieldName}
                  field={fields[fieldName]}
                  selections={childSelections}
                  modifySelections={this._modifyChildSelections}
                  schema={schema}
                  getDefaultFieldNames={getDefaultFieldNames}
                />
              ))}
            {isInterfaceType(type) || isUnionType(type)
              ? schema
                  .getPossibleTypes(type)
                  .map(type => (
                    <AbstractView
                      key={type.name}
                      implementingType={type}
                      selections={childSelections}
                      modifySelections={this._modifyChildSelections}
                      schema={schema}
                      getDefaultFieldNames={getDefaultFieldNames}
                    />
                  ))
              : null}
          </div>
        </div>
      );
    }
    return node;
  }
}

function parseQuery(text: string): ?DocumentNode | Error {
  try {
    if (!text.trim()) {
      return null;
    }
    return parse(text, {noLocation: true});
  } catch (e) {
    return new Error(e);
  }
}

let DEFAULT_DOCUMENT = {
  kind: 'Document',
  definitions: [],
};
let parseQueryMemoize: ?[string, DocumentNode] = null;
function memoizeParseQuery(query: string): DocumentNode {
  if (parseQueryMemoize && parseQueryMemoize[0] === query) {
    return parseQueryMemoize[1];
  } else {
    const result = parseQuery(query);
    if (!result) {
      return DEFAULT_DOCUMENT;
    } else if (result instanceof Error) {
      if (parseQueryMemoize) {
        // Most likely a temporarily invalid query while they type
        return parseQueryMemoize[1];
      } else {
        return DEFAULT_DOCUMENT;
      }
    } else {
      parseQueryMemoize = [query, result];
      return result;
    }
  }
}

type RootViewProps = {
  schema: GraphQLSchema,
  fields: GraphQLFieldMap<any, any>,
  operation: 'query' | 'mutation' | 'subscription',
  parsedQuery: DocumentNode,
  onEdit: (query: string) => void,
  getDefaultFieldNames: (type: GraphQLObjectType) => Array<string>,
};

class RootView extends React.PureComponent<RootViewProps, {}> {
  _previousOperationDef: ?OperationDefinitionNode;
  _getOperationDef = (parsedQuery: DocumentNode) => {
    const operation = parsedQuery.definitions.find(
      d =>
        d.kind === 'OperationDefinition' &&
        d.operation === this.props.operation,
    );
    const result = operation || {
      kind: 'OperationDefinition',
      operation: this.props.operation,
      selectionSet: {
        kind: 'SelectionSet',
        selections: [],
      },
    };
    if (result.kind !== 'OperationDefinition') {
      throw new Error('invalid operation');
    }
    return result;
  };

  _modifySelections = (selections: Selections) => {
    const {parsedQuery} = this.props;
    let operationDef = this._getOperationDef(parsedQuery);
    if (
      operationDef.selectionSet.selections.length === 0 &&
      this._previousOperationDef
    ) {
      operationDef = this._previousOperationDef;
    }
    if (selections.length === 0) {
      this._previousOperationDef = operationDef;
      this.props.onEdit(
        print({
          ...parsedQuery,
          definitions: parsedQuery.definitions.filter(d => d !== operationDef),
        }),
      );
    } else {
      const newOperationDef = {
        ...operationDef,
        selectionSet: {
          ...operationDef.selectionSet,
          selections,
        },
      };
      let replaced = false;
      const newDefinitions = parsedQuery.definitions.map(op => {
        if (op === operationDef) {
          replaced = true;
          return newOperationDef;
        } else {
          return op;
        }
      });

      this.props.onEdit(
        print({
          ...parsedQuery,
          definitions: replaced
            ? newDefinitions
            : [newOperationDef, ...newDefinitions],
        }),
      );
    }
  };

  render() {
    const {
      fields,
      operation,
      parsedQuery,
      schema,
      getDefaultFieldNames,
    } = this.props;
    const operationDef = this._getOperationDef(parsedQuery);
    const selections = operationDef.selectionSet.selections;
    return (
      <div
        style={{
          borderBottom: operation !== 'subscription' ? '1px solid #d6d6d6' : '',
          marginBottom: '1em',
          paddingBottom: '0.5em',
        }}>
        <div style={{color: '#B11A04', paddingBottom: 4}}>{operation}</div>
        {Object.keys(fields).map(fieldName => (
          <FieldView
            key={fieldName}
            field={fields[fieldName]}
            selections={selections}
            modifySelections={this._modifySelections}
            schema={schema}
            getDefaultFieldNames={getDefaultFieldNames}
          />
        ))}
      </div>
    );
  }
}

class Explorer extends React.PureComponent<Props, State> {
  _ref: ?any;
  _resetScroll = () => {
    const container = this._ref;
    if (container) {
      container.scrollLeft = 0;
    }
  };
  componentDidMount() {
    this._resetScroll();
  }
  render() {
    const {schema, query} = this.props;
    if (!schema) {
      return (
        <div style={{fontFamily: 'sans-serif'}} className="error-container">
          No Schema Available
        </div>
      );
    }
    const queryType = schema.getQueryType();
    const mutationType = schema.getMutationType();
    const subscriptionType = schema.getSubscriptionType();
    if (!queryType && !mutationType && !subscriptionType) {
      return <div>Missing query type</div>;
    }
    const queryFields = queryType && queryType.getFields();
    const mutationFields = mutationType && mutationType.getFields();
    const subscriptionFields = subscriptionType && subscriptionType.getFields();

    const parsedQuery = memoizeParseQuery(query);

    const getDefaultFieldNames =
      this.props.getDefaultFieldNames || defaultGetDefaultFieldNames;
    return (
      <div
        ref={ref => {
          this._ref = ref;
        }}
        style={{
          fontSize: 12,
          overflow: 'scroll',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          margin: 0,
          padding: 8,
          fontFamily:
            'Consolas, Inconsolata, "Droid Sans Mono", Monaco, monospace',
        }}
        className="graphiql-explorer-root">
        {queryFields ? (
          <RootView
            fields={queryFields}
            operation="query"
            parsedQuery={parsedQuery}
            onEdit={this.props.onEdit}
            schema={schema}
            getDefaultFieldNames={getDefaultFieldNames}
          />
        ) : null}
        {mutationFields ? (
          <RootView
            fields={mutationFields}
            operation="mutation"
            parsedQuery={parsedQuery}
            onEdit={this.props.onEdit}
            schema={schema}
            getDefaultFieldNames={getDefaultFieldNames}
          />
        ) : null}
        {subscriptionFields ? (
          <RootView
            fields={subscriptionFields}
            operation="subscription"
            parsedQuery={parsedQuery}
            onEdit={this.props.onEdit}
            schema={schema}
            getDefaultFieldNames={getDefaultFieldNames}
          />
        ) : null}
      </div>
    );
  }
}

class ExplorerWrapper extends React.PureComponent<Props, {}> {
  static defaultProps = {
    width: 380,
  };
  render() {
    return (
      <div
        className="historyPaneWrap"
        style={{
          height: '100%',
          width: this.props.width,
          zIndex: 7,
          display: this.props.explorerIsOpen ? 'block' : 'none',
        }}>
        <div className="history-title-bar">
          <div className="history-title">Explorer</div>
          <div className="doc-explorer-rhs">
            <div
              className="docExplorerHide"
              onClick={this.props.onToggleExplorer}>
              {'\u2715'}
            </div>
          </div>
        </div>
        <div className="history-contents">
          <Explorer {...this.props} />
        </div>
      </div>
    );
  }
}

export default ExplorerWrapper;