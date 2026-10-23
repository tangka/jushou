---
name: wechat-publication
description: 在明确授权范围内，通过已安装的Ego浏览器提交本号已验证草稿。
---

# 巨手：公众号发表

## 前提
读取本次用户指令和operator.local.json中目标账号的policy.dailyPublication、policy.egoSpace以及operations.publicationAuthorization。
账号须允许publish，且用户授权实际涵盖本篇、本号和本次操作；draft模式停在草稿。本轮明确指令优先，已有效授权不因换篇或普通确认弹窗重复询问。
此技能依赖已安装且可用的ego-browser及它提供的Agent接口。
先读取已安装的ego-browser/SKILL.md，并运行ego-browser skill获取当前版本用法。

## 执行
1. 复用本号已配置的Ego空间。核对微信后台实际名称，不以空间名字当身份证明。
2. 查本号当天记录和本篇提交记录。已受理、审核中或已发表的同一版本不重复提交。
3. 打开本次精确草稿，对照官方回读证据核对标题、全文、摘要、封面、图片、入口和版本哈希。
4. 按真实权属和用户授权设置原创、作者与合集；不能冒领翻译或转载的原创。
5. 读取可用群发额度，按用户授权决定通知。额度、身份或授权不明时停止提交。
6. 保存本篇提交意图，再按实际页面完成发表及后续确认；不要猜API或复用过期元素引用。
7. 官方确认已提交或审核中后，保存回执和版本证据，报告真实状态；已公开须另有证据。
8. 结果未知时仅做一次只读核验，不重复点击；用户接管、扫码或工具拒绝时按具体情况停止。

## 终验
将当次真实后台观测按当前校验器合同记录，运行 `pnpm verify-daily-publications -- --input <观测JSON路径>`。
校验器只核验输入证据，不会启动Ego或替你点击发表。

合同以仓库 `src/wechat/daily-publication-verifier.ts` 为准。顶层包含date、expectedAccountIds、verifiedAt和observations；expectedAccountIds必须与本机配置的全部日更账号一致，不能把其他账号的历史记录冒充本轮操作。单账号任务遇到配置中有其他账号时，如实保留本轮范围和未执行状态，不为凑终验操作额外账号。

每篇证据绑定实际账号、标题、载体和同一正文SHA-256，保存官方正文、封面、图片、入口、原创及通知设置核对。受理回执或审核中记录为publish_submitted，尚未公开的publishedCount为0；已公开必须有对应官方证据。通知开启或已发送必须带本次授权与可用额度证据。

只保存脱敏审计记录，不保存Cookie、密钥、二维码或带访问令牌的后台链接。收到真实受理结果即可结束，不为等待公开状态反复轮询或重复提交。
