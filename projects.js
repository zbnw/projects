/* ============================================================
   项目数据 —— 新增 / 修改 / 删除项目,只需要编辑这一个文件

   ------------------------------------------------------------
   每个项目是数组 PROJECTS 里的一个 { } 对象,字段说明:

     name   项目名称(必填)
     desc   一句话简介(必填,建议 30 字以内,手机上一行能放下最好看)
     tags   标签数组(必填,没有标签就写 []),用于右上角的标签筛选
     url    项目地址(必填)
              · 站内项目:相对路径,例如 "./bn01enc/"
                (要求该文件夹和 index.html 在同一目录下,
                 文件夹里放这个项目自己的 index.html)
              · 站外项目:完整链接,例如 "https://github.com/xxx/xxx"
     date   更新日期(选填,格式 "2026-06"),只用于展示在最右侧,
            不填的话该项目这一栏留空,不影响列表顺序

   ------------------------------------------------------------
   显示顺序 = 数组里的顺序,写在前面的显示在最上面。
   想置顶某个项目,直接把它的 { ... } 整段移到数组最前面即可。

   ------------------------------------------------------------
   新增一个项目,复制下面这一段,粘贴到 PROJECTS 数组里(顺序随意),
   改掉里面的内容,注意每段结尾的逗号不要漏掉:

   {
     name: "项目名称",
     desc: "一句话简介",
     tags: ["标签1", "标签2"],
     url: "./folder-name/",
     date: "2026-06",
   },
   ============================================================ */

const SITE = {
  title: "Beining的小项目集",
  subtitle: "收录一些我的小项目，大多数依靠人工智能完成，偶尔更新，还会收录一些国内外的有趣项目",
};

const PROJECTS = [
  {
    name: "Time Encrypt",
    desc: "一刻钟内有效的无状态临时密文工具",
    tags: ["加密", "工具", "开源"],
    url: "./timenc/",
    date: "2026-07",
  },

  // 转载目录来源：https://aem1k.com/（Martin Kleppe / @aemkei）
  {
    name: "Hello World 1K",
    desc: "转载自 aem1k：嵌入 JavaScript 源码中的旋转地球",
    tags: ["转载","aem1k","创意编程"],
    url: "https://aem1k.com/world",
    date: "2026-07",
  },
  {
    name: "JSFuck.com",
    desc: "转载自 aem1k：只用 []()!+ 六种字符编写 JavaScript",
    tags: ["转载","aem1k","JavaScript"],
    url: "https://www.jsfuck.com/",
    date: "2026-07",
  },
  {
    name: "aurebesh.js",
    desc: "转载自 aem1k：把 JavaScript 转换为其他书写系统",
    tags: ["转载","aem1k","JavaScript"],
    url: "https://aem1k.com/aurebesh.js/",
    date: "2026-07",
  },
  {
    name: "Qlock",
    desc: "转载自 aem1k：会显示时间的 JavaScript 自复制程序",
    tags: ["转载","aem1k","Quine"],
    url: "https://aem1k.com/qlock/",
    date: "2026-07",
  },
  {
    name: "tixy.land",
    desc: "转载自 aem1k：极简创意代码高尔夫环境",
    tags: ["转载","aem1k","代码高尔夫"],
    url: "https://tixy.land/",
    date: "2026-07",
  },
  {
    name: "Alien Art",
    desc: "转载自 aem1k：用简单公式生成位域艺术",
    tags: ["转载","aem1k","创意编程"],
    url: "https://x.com/aemkei/status/1378106731386040322",
    date: "2026-07",
  },
  {
    name: "Meta",
    desc: "转载自 aem1k：元球动画与 JavaScript Quine",
    tags: ["转载","aem1k","Quine"],
    url: "https://aem1k.com/meta/quine/",
    date: "2026-07",
  },
  {
    name: "// VOID",
    desc: "转载自 aem1k：使用不可见变量和代码的实验",
    tags: ["转载","aem1k","JavaScript"],
    url: "https://aem1k.com/void/",
    date: "2026-07",
  },
  {
    name: "INCEPT10N",
    desc: "转载自 aem1k：同时是 JPEG、CSS、JS 与 HTML 的多语言文件",
    tags: ["转载","aem1k","Polyglot"],
    url: "https://incept10n.com/",
    date: "2026-07",
  },
  {
    name: "Theseus",
    desc: "转载自 aem1k：迷宫生成与自动求解",
    tags: ["转载","aem1k","创意编程"],
    url: "https://aem1k.com/theseus",
    date: "2026-07",
  },
  {
    name: "Mona",
    desc: "转载自 aem1k：用不足 512 字节盲画蒙娜丽莎",
    tags: ["转载","aem1k","代码高尔夫"],
    url: "https://aem1k.com/mona",
    date: "2026-07",
  },
  {
    name: "M4TR1X 雨",
    desc: "转载自 aem1k：仅用亚洲字符实现代码雨",
    tags: ["转载","aem1k","创意编程"],
    url: "https://aem1k.com/%E9%9B%A8",
    date: "2026-07",
  },
  {
    name: "שלום-עולם",
    desc: "转载自 aem1k：使用希伯来字母编写的有效 JavaScript",
    tags: ["转载","aem1k","JavaScript"],
    url: "https://aem1k.com/%D7%A9%D7%9C%D7%95%D7%9D-%D7%A2%D7%95%D7%9C%D7%9D",
    date: "2026-07",
  },
  {
    name: "Mandelcode",
    desc: "转载自 aem1k：在 JavaScript 边界中缩放的分形 Quine",
    tags: ["转载","aem1k","Quine"],
    url: "https://aem1k.com/mandelcode",
    date: "2026-07",
  },
  {
    name: "א The Aleph",
    desc: "转载自 aem1k：从单个字符中生成生命图案",
    tags: ["转载","aem1k","创意编程"],
    url: "https://aem1k.com/aleph",
    date: "2026-07",
  },
  {
    name: "ffconf",
    desc: "转载自 aem1k：太空中的动态 ffconf 标志",
    tags: ["转载","aem1k","动画"],
    url: "https://aem1k.com/ffconf",
    date: "2026-07",
  },
  {
    name: "ЗВЕЗДА СМЕРТИ · Death Star",
    desc: "转载自 aem1k：666 字节 ASCII 死星攻击动画",
    tags: ["转载","aem1k","代码高尔夫"],
    url: "https://aem1k.com/deathstar",
    date: "2026-07",
  },
  {
    name: "Life",
    desc: "转载自 aem1k：176 字节 HTML 与 JS 实现生命游戏",
    tags: ["转载","aem1k","代码高尔夫"],
    url: "https://aem1k.com/life",
    date: "2026-07",
  },
  {
    name: "Invisible Code",
    desc: "转载自 aem1k：隐藏源代码实验，仅支持 Chrome",
    tags: ["转载","aem1k","JavaScript"],
    url: "https://aem1k.com/0",
    date: "2026-07",
  },
  {
    name: "Four",
    desc: "转载自 aem1k：隐藏在八进制布局中的俄罗斯方块",
    tags: ["转载","aem1k","游戏"],
    url: "https://aem1k.com/4",
    date: "2026-07",
  },
  {
    name: "Pac-Man",
    desc: "转载自 aem1k 等作者：不足 512 字节的经典吃豆人",
    tags: ["转载","aem1k","游戏"],
    url: "https://github.com/codegolf/pac-man",
    date: "2026-07",
  },
  {
    name: "Binary Tetris",
    desc: "转载自 aem1k：140 字节 JavaScript 俄罗斯方块",
    tags: ["转载","aem1k","游戏"],
    url: "https://gist.github.com/aemkei/1672254",
    date: "2026-07",
  },
  {
    name: "Katakana.js",
    desc: "转载自 aem1k：使用日文字符编写 JavaScript",
    tags: ["转载","aem1k","JavaScript"],
    url: "https://github.com/aemkei/katakana.js",
    date: "2026-07",
  },
  {
    name: "FÌRE",
    desc: "转载自 aem1k：128 字节 JavaScript 火焰动画",
    tags: ["转载","aem1k","代码高尔夫"],
    url: "https://aem1k.com/fire",
    date: "2026-07",
  },
  {
    name: "wãter",
    desc: "转载自 aem1k：利用组合字符实现 128 字节波浪",
    tags: ["转载","aem1k","代码高尔夫"],
    url: "https://aem1k.com/water",
    date: "2026-07",
  },
  {
    name: "Tic-Tac-Tweet",
    desc: "转载自 aem1k：140 字符井字棋游戏",
    tags: ["转载","aem1k","游戏"],
    url: "https://aem1k.com/tic-tac-tweet/",
    date: "2026-07",
  },
  {
    name: "Ping",
    desc: "转载自 aem1k 等作者：不足 256 字节的 Pong × Breakout",
    tags: ["转载","aem1k","游戏"],
    url: "https://github.com/codegolf/ping",
    date: "2026-07",
  },
];
