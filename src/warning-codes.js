/* 兼容旧草稿中的中文警告；持久化只使用稳定标识。 */
const legacy = {
  宏: 'macros', 图片: 'images', 图表: 'charts', 透视表: 'pivotTables',
  线程批注: 'threadedComments', 外部链接: 'externalLinks', 筛选条件: 'filters',
  筛选范围: 'filterRange', 数据验证: 'validation', 条件格式: 'conditionalFormatting',
  超链接: 'hyperlinks', 工作表保护: 'protection', 结构化表格: 'tables',
};
const supported = new Set([...Object.values(legacy), 'other']);
export function normalizeWarnings(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => supported.has(value) ? value :
    (typeof value === 'string' && Object.hasOwn(legacy, value) ? legacy[value] : 'other')))];
}
