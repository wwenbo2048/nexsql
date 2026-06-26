## 1. 核心系统与工具
项目采用 **Tailwind CSS** 作为核心样式框架，配合 **PostCSS** 和 **Autoprefixer** 进行构建。整体设计风格为**深色模式（Dark Mode）**，强调高对比度与专业开发工具的视觉体验。

- **CSS 方法论**：Utility-first (Tailwind CSS)。
- **图标库**：`lucide-react`，提供简洁、一致的线性图标。
- **字体系统**：
  - UI 界面：`Inter` (无衬线字体)，确保清晰易读。
  - 代码/数据：`JetBrains Mono` (等宽字体)，用于 SQL 编辑器及数据表格。

## 2. 设计令牌 (Design Tokens)
在 `tailwind.config.js` 中定义了语义化的颜色变量，实现了统一的视觉语言：

- **背景色 (`bg-*`)**：
  - `primary` (#1a1b1e): 主背景（如编辑器、表格区域）。
  - `secondary` (#25262b): 侧边栏、表头背景。
  - `tertiary` (#2c2e33): 悬停或次级容器背景。
- **强调色 (`accent-*`)**：
  - `DEFAULT` (#3b82f6): 品牌蓝，用于选中状态、按钮及高亮。
- **文本色 (`text-*`)**：
  - `primary` (#e4e4e7): 主要文字。
  - `secondary` (#a1a1aa): 次要文字/标签。
- **边框色 (`border-*`)**：用于分割线与组件边界，保持低调的视觉干扰。

## 3. 组件样式约定
- **全局样式**：在 `index.css` 中重置了默认边距，并自定义了滚动条样式（细窄、深色），以匹配整体深色主题。
- **第三方组件适配**：
  - **Monaco Editor**：通过 CSS 变量强制覆盖背景色，确保与 `bg-primary` 融合。
  - **React Data Grid**：定义了 `--rdg-*` 系列 CSS 变量，统一表格的行高、边框、选中色及字体。
- **交互反馈**：
  - 拖拽手柄 (`.resize-handle`)：默认透明，悬停或拖拽时显示品牌蓝。
  - 上下文菜单 (`.context-menu-item`)：悬停时切换为背景蓝、文字白。

## 4. 开发者规范
1. **优先使用 Tailwind 类名**：在 JSX 中直接引用 `bg-bg-primary`, `text-text-secondary` 等语义化类名，避免硬编码颜色值。
2. **复杂样式写入 CSS**：针对第三方库（如 Monaco, RDG）的样式覆盖或关键帧动画（如 `spin`, `pulse`），统一在 `index.css` 中维护。
3. **保持一致性**：新增组件时应复用 `tailwind.config.js` 中定义的颜色令牌，确保在深色主题下的视觉一致性。