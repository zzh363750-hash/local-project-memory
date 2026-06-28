# Local Project Memory PRD

## 1. 产品定位

Local Project Memory 是一个面向开发者和知识工作者的本地项目记忆助手。

它可以读取用户本地项目文件、Markdown、PDF、笔记和 Git 记录，帮助用户进行项目问答、引用来源、生成项目总结、日报和周报。

一句话：

让用户快速恢复项目上下文，并自动生成可信、有来源的项目总结和周报。

---

## 2. 目标用户

第一阶段目标用户：

1. 独立开发者
2. 小团队技术负责人
3. 产品经理
4. 知识工作者

他们的问题是：

- 项目资料太分散；
- 过一段时间就忘了项目进展；
- 写周报和项目总结很麻烦；
- 普通文件搜索只能找到文件，不能总结上下文；
- 通用 AI 工具不了解本地项目资料。

---

## 3. 核心场景

### 场景一：恢复项目上下文

用户可以问：

- 这个项目现在做到哪了？
- 已经完成了哪些功能？
- 还有哪些 TODO？
- 技术栈是什么？
- 上次为什么这么设计？

### 场景二：基于本地资料问答

用户可以问：

- 项目的核心功能有哪些？
- PRD 里提到的 MVP 范围是什么？
- 有哪些暂不支持的功能？
- 数据库设计在哪里？

系统回答时必须尽量给出来源文件。

### 场景三：生成项目总结

系统可以生成：

- 项目简介
- 当前目标
- 核心功能
- 当前进展
- 已完成事项
- 待办事项
- 技术架构
- 风险点
- 下一步建议

### 场景四：生成日报 / 周报

系统可以根据最近修改的文件、Git commit、笔记和 TODO，生成项目日报或周报。

---

## 4. MVP 功能范围

第一版只做这些功能：

1. 创建项目空间
2. 选择本地项目文件夹
3. 扫描本地文件
4. 读取 Markdown、txt、代码文件和 PDF
5. 将文件内容分块
6. 建立本地索引
7. AI 问答
8. 回答时显示引用来源
9. 生成项目总结
10. 生成周报
11. 导出 Markdown

---

## 5. 暂不支持的功能

第一版不做：

- 邮件处理
- 日历管理
- 浏览器自动操作
- 自动跑脚本
- 自动修改文件
- 自动删除文件
- 自动发送邮件
- 多 Agent
- 插件市场
- 云同步
- 团队协作
- 完全离线大模型

---

## 6. 用户流程

### 首次使用

1. 打开 App
2. 输入 API Key
3. 创建项目
4. 选择本地文件夹
5. 扫描文件
6. 建立索引
7. 开始问答
8. 生成项目总结或周报

### 项目问答

1. 用户进入项目
2. 输入问题
3. 系统检索相关资料
4. AI 生成回答
5. 显示引用来源
6. 保存问答历史

### 生成周报

1. 用户进入项目
2. 点击生成周报
3. 系统读取最近 7 天修改内容和 Git commit
4. 生成 Markdown 周报
5. 用户复制或导出

---

## 7. 页面结构

第一版需要这些页面：

1. 欢迎页
2. 项目列表页
3. 项目详情页
4. 问答页
5. 文件索引页
6. 报告页
7. 设置页

---

## 8. 数据结构

### projects

保存项目信息：

- id
- name
- description
- root_path
- created_at
- updated_at
- last_indexed_at

### files

保存文件信息：

- id
- project_id
- path
- relative_path
- file_type
- size
- hash
- modified_at
- indexed_at
- status

### chunks

保存文件分块：

- id
- project_id
- file_id
- content
- start_line
- end_line
- token_count
- created_at

### conversations

保存问答历史：

- id
- project_id
- question
- answer
- sources_json
- created_at

### reports

保存项目总结和周报：

- id
- project_id
- report_type
- title
- content
- sources_json
- created_at

---

## 9. 技术栈

第一版推荐技术栈：

- 桌面端：Tauri
- 前端：React + TypeScript + Vite
- 本地数据库：SQLite
- 向量检索：LanceDB 或 sqlite-vec
- AI 模型：OpenAI API
- 文档解析：TypeScript 侧处理
- Git 读取：simple-git
- UI：Tailwind CSS + shadcn/ui

---

## 10. 第一阶段里程碑

### Milestone 0：项目文档和初始化

目标：

- 建立项目文件夹
- 创建 PRD.md
- 初始化 Tauri 项目

### Milestone 1：桌面壳和项目管理

目标：

- App 能启动
- 能创建项目
- 能选择本地文件夹
- 能保存项目

### Milestone 2：文件扫描

目标：

- 扫描项目文件夹
- 过滤 node_modules、dist、build 等目录
- 展示文件列表

### Milestone 3：文件索引

目标：

- 读取文件内容
- 分块
- 保存到本地数据库

### Milestone 4：AI 问答

目标：

- 根据用户问题检索相关资料
- 调用 AI 生成回答
- 显示引用来源

### Milestone 5：项目总结和周报

目标：

- 生成项目总结
- 生成最近 7 天周报
- 支持复制或导出 Markdown