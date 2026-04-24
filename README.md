# Evolve Userscript Speed Fork / Evolve时间流速修改（作弊）

基于 `by22dgb/evolvescript` 的本地修改版。

## 署名与来源

- 早期脚本链路来自 `TMVictor` 的 Evolve Scripting Edition
- 后续迁移说明中，`TMVictor` 明确引导用户安装 `Vollch` 维护的独立脚本版本
- 当前脚本头部保留的作者署名包括：
  - `Fafnir`
  - `TMVictor`
  - `Vollch`
  - `schoeggu`
  - `davezatch`
  - `Kewne`
- 在较新的 `Vollch` 版本中，还能看到新增署名 `SkyeAmphi`

参考链接：

- `TMVictor` 仓库迁移说明：<https://github.com/TMVictor/Evolve-Scripting-Edition>
- `Vollch` 维护脚本：<https://gist.github.com/Vollch/b1a5eec305558a48b7f4575d317d7dd1>
- 当前分支基于的上游仓库：<https://github.com/by22dgb/evolvescript>

当前已知情况：

- `10x` 稳定运行
- `10x` 以上存在 bug，慎用

说明：

- 这是用户脚本版本，不是完整游戏仓库
- 开启时间流速功能视为作弊
- 我本人不推荐使用
- 此功能仅供本人自用
- 高倍率属于实验功能，请自行评估风险
- 原始项目来源：<https://github.com/by22dgb/evolvescript>

文件：

- `evolve_automation.user.js`

## 本地存档改值工具

工具文件：

- `tools/evolve-save-editor.mjs`

最常用命令：

```bash
node tools/evolve-save-editor.mjs ~/Downloads/evolve.txt \
  --probes 100 \
  --stellar-exotic 1e9 \
  --plasmids 100000 \
  --antiplasmids 100000 \
  --phage 5000 \
  --dark-energy 100 \
  --resource 精金=max \
  --resource 地狱石=100m
```

执行后会自动完成：

- 解码 Evolve 导出存档
- 创建同目录时间戳备份，例如 `evolve.txt.bak-20260424T021500Z`
- 只修改指定字段
- 重新压缩并覆盖原存档
- 回读原文件并校验修改值

常用参数：

```bash
# 只看当前支持字段，不改文件
node tools/evolve-save-editor.mjs ~/Downloads/evolve.txt --print

# 预览改动，不写入
node tools/evolve-save-editor.mjs ~/Downloads/evolve.txt --dry-run --probes 100

# 只解码成 JSON，方便检查字段
node tools/evolve-save-editor.mjs ~/Downloads/evolve.txt --dump-json decoded-save.json

# 查看当前存档里的 resource key
node tools/evolve-save-editor.mjs ~/Downloads/evolve.txt --list-resources
```

已内置的重点字段：

- `--probes`：星际探测器数量，会检查 `starDock.probes.count` 和 `space.star_dock.probe`
- `--stellar-exotic`：恒星引擎奇异物质，对应 `interstellar.stellar_engine.exotic`
- `--plasmids`：质粒
- `--antiplasmids`：反质粒
- `--phage`：噬菌体
- `--dark-energy`：暗能量
- `--resource 名称=值`：常见资源定点修改，可重复使用；值支持 `max`、普通数字、`100m`、`1e9`、`1亿`、`10万`
