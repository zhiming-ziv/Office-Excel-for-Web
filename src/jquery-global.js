import npmJQuery from 'jquery';
import mousewheelFactory from 'jquery-mousewheel';

/*
 * Luckysheet 的官方插件包（= node_modules/luckysheet/dist/plugins/js/plugin.js，
 * 由 vite.config.js 自动同步到 public/luckysheet-plugin.js）以「经典 script」方式
 * 先于本模块加载。它内部打包了 jQuery + spectrum 取色器 + sPage 分页 + jQuery UI，
 * 并会把这份 jQuery 挂到 window.$ / window.jQuery 上。
 *
 * Luckysheet 的文字颜色 / 单元格底色 / 边框颜色面板依赖 $.fn.spectrum，
 * 因此这里优先复用插件包提供的全局实例；只有它缺失时才退回 npm jquery。
 * 否则用 npm jquery 覆盖 window.$ 会让 spectrum 等插件全部失效
 * （表现为点开颜色面板报 “$(...).spectrum is not a function”，面板空白）。
 */
const globalJQ = typeof window !== 'undefined' ? window.jQuery : null;
const jQuery = globalJQ && globalJQ.fn && globalJQ.fn.spectrum ? globalJQ : npmJQuery;

// 插件包已内置 mousewheel 时无需重复挂载
if (jQuery.fn && !jQuery.fn.mousewheel) {
  try {
    mousewheelFactory(jQuery);
  } catch (e) {
    console.warn('jquery-mousewheel 挂载失败：', e);
  }
}

window.$ = window.jQuery = jQuery;

export default jQuery;
