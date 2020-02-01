import DatePlugin from './bundled/DateInput'

const bundledPlugins = [DatePlugin];

class ScalarInputPluginManager {
  constructor(plugins = [], enableBundledPlugins = false) {
    let enabledPlugins = plugins;
    if (enableBundledPlugins) {
      // ensure bundled plugins are the last plugins checked.
      enabledPlugins.push(...bundledPlugins);
    }
    this.plugins = enabledPlugins;
  }

  process(arg, styleConfig, onChangeHandler) {    
    // plugins are provided in order, the first matching plugin will be used.
    const handler = this.plugins.find(plugin => plugin.canProcess(arg));
    if (handler) {
      return handler.render(arg, styleConfig, onChangeHandler);
    }
    return null;
  }
}

export default ScalarInputPluginManager;