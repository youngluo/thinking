# Thinking

[![lerna](https://img.shields.io/badge/maintained%20with-lerna-cc00ff.svg)](https://lerna.js.org/)

### Commands

#### Yarn workspace

```shell
# install public dependencies in the root directory
yarn add -W <package>

# install dependencies for the specified workspace
yarn workspace <workspace> add <package>

# execute commands in all workspace
yarn workspaces run <command>

# execute the command in the specified workspace
yarn workspace <workspace> <command>
```

#### Lerna

```shell
# install dependencies for packages/*
lerna add <package>

# install dependencies for the specified workspace
lerna add <package> --scope <workspace>

# execute commands in all workspace
lerna run <command>
```
