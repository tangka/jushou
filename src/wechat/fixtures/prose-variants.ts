import type { ProseFinding } from '../prose-patterns.js';

type Sample = { id: string; expected: ProseFinding['id'] | null; text: string };

// 先固定样本及预期再修改规则；全为合成测试文本，不是可发布稿件或事实材料。
export const proseVariants: readonly Sample[] = [
  {
    id: 'self-stage-pose',
    expected: 'performed-emotion',
    text: '这回先让我叉会儿腰，再聊新功能。',
  },
  {
    id: 'self-stage-permission',
    expected: 'performed-emotion',
    text: '请准我小小地膨胀三秒钟，之前的判断总算兑现了。',
  },
  {
    id: 'self-stage-applause',
    expected: 'performed-emotion',
    text: '开头先给自己鼓个掌，这次真的押中了。',
  },
  {
    id: 'self-stage-cheer',
    expected: 'performed-emotion',
    text: '我得先为自己喝个彩，然后再把细节补上。',
  },
  {
    id: 'self-stage-announcement',
    expected: 'performed-emotion',
    text: '我先宣布一下：今天的快乐由这个更新承包。',
  },
  {
    id: 'role-split-producer-recipient',
    expected: 'performed-emotion',
    text: '厂商负责画饼，我只管把福利揣进兜里。',
  },
  {
    id: 'role-split-inverted-object',
    expected: 'performed-emotion',
    text: '你们继续整活，便宜我就先占了。',
  },
  {
    id: 'role-split-assignment',
    expected: 'performed-emotion',
    text: '排面留给官方，实惠留给咱们。',
  },
  {
    id: 'role-split-across-sentences',
    expected: 'performed-emotion',
    text: '你负责把场子点燃。我负责把折扣领回家。',
  },
  {
    id: 'role-split-verb-and-noun-change',
    expected: 'performed-emotion',
    text: '版本你尽管更，礼包我照单全收。',
  },
  {
    id: 'precision-new-clock-values',
    expected: 'precision-overload',
    text: '23:58:47刷新还是旧数，23:59:03出现变化，23:59:18又重新读了一次。',
  },
  {
    id: 'precision-mixed-notation',
    expected: 'precision-overload',
    text: '09时06分12秒还没动，０９：０６：１８显示到账，09 : 06 : 23再次确认。',
  },
  {
    id: 'precision-chinese-numbers',
    expected: 'precision-overload',
    text: '九点六分十二秒刷新页面，九点六分十八秒重新读取，九点六分二十三秒又确认了一遍。',
  },
  {
    id: 'precision-fractional-seconds',
    expected: 'precision-overload',
    text: '记录分别是09:06:12.137、09:06:12.429和09:06:12.804，三个数字都列出来了。',
  },
  {
    id: 'transitions-rewording',
    expected: 'transition-overload',
    text: '换个讲法，套餐能续了。改一种说法，资格没有丢。翻译成大白话，就是这回还能买。',
  },
  {
    id: 'transitions-inference-and-evaluation',
    expected: 'transition-overload',
    text: '这也就意味着钱省下来了。这相当于少交一次账单。这个细节尤其让我受用，规则终于改了。',
  },
  {
    id: 'transitions-narrator-tour',
    expected: 'transition-overload',
    text: '往下看，客户端也变了。接下来再来说说导出，按钮位置没动。再往前推一步，整个流程接上了。',
  },
  {
    id: 'paragraph-question-bookends',
    expected: 'paragraph-template',
    text: [
      '这还需要犹豫？新版把3个入口并在一个页面，常用操作不用再跳标签。谁用着不舒坦？',
      '这波怎么接？导出现在能一次处理5份文件，之前要一份份选。谁看了还能装作无事发生？',
      '还有这种事？更新后10个任务能同时排队，终于不用蹲着点下一次。谁还乐意回到旧版？',
    ].join('\n\n'),
  },
  {
    id: 'paragraph-uniform-functions-varied-lengths',
    expected: 'paragraph-template',
    text: [
      '好家伙。费用由包年改成按月，停用后不用继续交。这样才像样。',
      '嘿，还真改了。新版支持直接导入已有文件，过去那几次手工复制都可以省掉。连目录里的备注也能带过来。总算没白等。',
      '行啊。原来需要点3次，现在点1次就完成，按钮也放回了首页。这个安排我认。',
    ].join('\n\n'),
  },
  {
    id: 'paragraph-cycle-split-into-short-blocks',
    expected: 'paragraph-template',
    text: [
      '谁能想到？',
      '套餐由包年改成按月，停用后不用继续交钱。',
      '这下踏实了。',
      '还真有这出？',
      '新版支持直接导入文件，过去需要手工复制。',
      '终于像样了。',
      '怎么连这都改了？',
      '3个任务可以一起提交，之前得一个一个排。',
      '这才够意思。',
    ].join('\n\n'),
  },
  {
    id: 'real-emotion-with-a-specific-cause',
    expected: null,
    text: '我是真的高兴。上个月被卡住的那份设计，今天总算交出去了，客户也确认收到了。',
  },
  {
    id: 'negated-self-applause',
    expected: null,
    text: '我不想给自己鼓掌，这个漏洞还没补完。',
  },
  {
    id: 'negated-victory-announcement',
    expected: null,
    text: '我不会在这里宣布胜利，超时问题还在重现。',
  },
  {
    id: 'permission-without-performance',
    expected: null,
    text: '我允许自己犯错，但上线前必须检查日志。',
  },
  {
    id: 'literal-work-assignment',
    expected: null,
    text: '你负责写接口，我负责写测试，周五一起联调。',
  },
  {
    id: 'literal-coupon-operation',
    expected: null,
    text: '你把优惠券发给客户，我核对订单号。',
  },
  {
    id: 'literal-document-routing',
    expected: null,
    text: '合同交给财务，截图留给设计，盖章后一起归档。',
  },
  {
    id: 'literal-kitchen-task',
    expected: null,
    text: '锅铲你拿着，切好的菜我端过去。',
  },
  {
    id: 'same-instant-in-three-notations',
    expected: null,
    text: '接口记录09:06:12，截图写作09时06分12秒，口述是九点六分十二秒。',
  },
  {
    id: 'ordinary-minute-resolution',
    expected: null,
    text: '上午09:06开工，09:18完成导入，09:23已经交付。',
  },
  {
    id: 'version-numbers-not-clocks',
    expected: null,
    text: '这次从1.2.3升级到1.2.4，兼容检查用的是2.3.1。',
  },
  {
    id: 'operational-sequence',
    expected: null,
    text: '先打开工程，随后选择导出，接下来填写文件名，最后保存到本地目录。',
  },
  {
    id: 'literal-causal-explanation',
    expected: null,
    text: '因为权限没有打开，所以文件没有写入。给目录补上权限后再试，这次输出成功了。',
  },
  {
    id: 'equal-length-factual-paragraphs',
    expected: null,
    text: [
      '新版把三个入口并到一个页面，原来的标签仍保留在侧边栏。用户可以手工调整顺序。',
      '这次导出增加了文件名选项，旧模板会继续沿用已有命名。新建模板才会弹出输入框。',
      '同步任务每天会运行两次，失败记录保存在任务详情页。管理员可以从那里重新提交。',
    ].join('\n\n'),
  },
  {
    id: 'strong-voice-without-the-same-cycle',
    expected: null,
    text: [
      '操，又要重登。',
      '我把图片传到一半，登录页突然蹦了出来。那张图还得重传，今天第三次了。',
      '烦。真烦。',
      '新界面倒是挺好看，这个我承认。可我今天要交稿，漂亮救不了卡在半路的文件。',
    ].join('\n\n'),
  },
  {
    id: 'quoted-variant',
    expected: null,
    text: '> 请准我小小地膨胀三秒钟。\n> 厂商负责画饼，我只管把福利揣进兜里。\n\n这两句都是原话。',
  },
  {
    id: 'code-variant',
    expected: null,
    text: '```python\nprint("开头先给自己鼓个掌")\nprint("09时06分12秒、09时06分18秒、09时06分23秒")\n```',
  },
  {
    id: 'third-person-description',
    expected: null,
    text: '他先给自己鼓了掌，随后走到台下和队友拥抱。镜头拍到了这个动作。',
  },
];
