参考https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md
集成Pi agent到我的项目中
注意
- Agent可配置项尽可能全面且重要
- skill支持

1 删除不重要的Pi Agent设置：会话目录、 禁用 Pi 会话持久化、Steering 队列、Follow-up 队列
2 Pi Provider改成下拉菜单，参考https://pi.dev/docs/latest/providers?utm_source=chatgpt.
com#api-keys，同时也支持自定义填入；
且在Pi Provider下方会联动弹出Provider对应的Environment Variable输入框，要求用户填入api key,会自动保存到pi auth.json中，如果api key已存在于auth.json，也会显示在输入框中，方便编辑
3 模型为必填项，未填入时会给红色提示
4 当各种原因导致pi对话异常时，要将pi的错误输出显示在AI对话中