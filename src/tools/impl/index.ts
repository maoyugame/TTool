// 工具自动发现：用 Vite 的 import.meta.glob 急切导入 impl/ 下所有工具模块，
// 每个模块在加载时调用 registerTool() 完成自注册。
//
// 这意味着「新增/接入一个工具 = 往 impl/ 里放一个文件（或一个文件夹）」，
// 无需改动本文件、注册表或外壳——多个 agent 并行产出的工具落盘即接入，互不冲突。
//
// 支持两种放置方式：
//   - 单文件工具：  impl/<id>.tsx
//   - 带资源的工具：impl/<id>/index.tsx（同目录可放该工具自己的图标等资源）
// 展示顺序由各工具的 order 字段决定（见 ToolPlugin.order），与文件名/加载顺序无关。
const modules = import.meta.glob(['./*.tsx', './*/index.tsx'], { eager: true })
void modules
