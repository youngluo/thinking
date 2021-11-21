# thinking

[![lerna](https://img.shields.io/badge/maintained%20with-lerna-cc00ff.svg)](https://lerna.js.org/)

### command

#### yarn workspace

```shell
# 在根目录安装公共依赖
yarn add -W <package-name>
# 为指定 workspace 安装依赖
yarn workspace <workspace-name> add <package-name>
# 在所有 workspace 中执行命令
yarn workspaces run <command>
# 在指定 <workspace> 中执行命令
yarn workspace <workspace> <command>
```

#### lerna

```shell
# 为所有 packages/* 安装依赖
lerna add <package-name>
# 为单个 workspace 安装依赖
lerna add <package-name> --scope <workspace-name>
# 在所有 workspace 中执行命令
lerna run <command>
```
