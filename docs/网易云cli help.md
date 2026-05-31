PS C:\WINDOWS\system32> ncm-cli commands
play                      播放音频 URL、歌曲加密 ID 或歌单
  --playlist            歌单模式：顺序播放整个歌单（需配合 --encrypted-id 或 --original-id 提供歌单 ID）
  --song                歌曲模式：播放单曲（需配合 --encrypted-id 与 --original-id 提供歌曲 ID）
  --encrypted-id        资源加密 ID（歌曲为32位hex，歌单为数字ID）
  --original-id         资源原始 ID（歌曲为明文数字ID，歌单为数字ID）

pause                     暂停播放
resume                    恢复播放
stop                      停止播放
next                      下一首
prev                      上一首
seek <seconds>            跳转到指定时间（秒）
volume <level>            设置音量 (0-100)
queue [subcommand] [url]  播放队列管理（queue | queue add <url/id> | queue clear）
  --encrypted-id        资源加密 ID（歌曲为32位hex）
  --original-id         资源原始 ID（歌曲为明文数字ID）
  --next                插入到当前播放的下一首位置（默认追加到队列末尾）

state                     查看播放状态
login                     登录网易云音乐
  --check               检查登录状态
  --background          后台轮询模式，主进程立即退出

logout                    退出登录
configure                 交互式配置向导：设置 API 凭证和播放器
upgrade                   升级到最新版本
config                    配置管理（config set/get/list）
  set                   设置配置项
  get                   获取配置项
  list                  列出所有配置项

cloudupload               网盘上传相关命令
  upload                上传音频文件或目录到云盘（支持多个路径）
  status                查询后台上传任务进度
  stop                  停止运行中的后台上传任务
  list                  列出所有后台上传任务
  uploadFile            上传通用文件到云盘（不限音频）

cloud                     网盘相关命令
  downloadFile          下载网盘文件到本地
  list                  获取网盘歌曲列表（游标分页）
  listFile              获取网盘文件列表
  updateSort            更新网盘歌曲排序

diag                      诊断与反馈（diag report）
  report                主动上报当前日志文件到日志召回平台（需要登录）

album                     专辑相关命令
  collected             获取我收藏的专辑列表
  get                   获取专辑详情
  tracks                获取专辑歌曲列表

artist                    艺人相关命令
  songs                 获取指定发布时间内艺人下的歌曲列表

comment                   评论相关命令
  list-hot              获取热门评论
  post                  发布一级评论
  reply                 回复评论

note                      笔记相关命令
  delete                删除笔记
  detail                查看笔记详情
  publish               发布一条笔记
  topicSearch           搜索话题，可用在发布笔记关联话题时使用

playlist                  歌单相关命令
  add                   向歌单批量添加歌曲
  collected             获取我收藏的歌单列表
  create                创建歌单
  created               获取我创建的歌单列表
  get                   获取歌单详情
  getTags               获取可选歌单标签列表
  radar                 获取雷达歌单
  remove                从歌单批量删除歌曲
  reorder               调整歌单歌曲顺序
  tracks                获取歌单歌曲列表
  updateCover           更新歌单封面
  updateDesc            更新歌单描述
  updateName            更新歌单标题
  updateTags            更新歌单标签

podcast                   播客与声音相关命令
  collected             获取我收藏的播单（瀑布流分页）
  created               获取我创建的播单（瀑布流分页，按创建时间或最近节目时间排序）
  get                   批量查询播单详情
  subscribe             收藏播单
  unsubscribe           取消收藏播单
  voices                获取播单下的声音列表

recommend                 推荐相关命令
  daily                 获取每日推荐歌曲
  fm                    场景私人漫游
  heartbeat             心动模式（基于当前歌曲推荐）

search                    搜索命令（歌曲、专辑、歌单、综合）
  album                 搜索专辑
  all                   综合搜索（歌曲、歌单、专辑、艺人）
  mv                    搜索MV
  playlist              搜索歌单
  podcast               搜索播单
  song                  搜索歌曲
  voice                 搜索声音（播客节目）

song                      歌曲相关命令
  dislike               取消红心歌曲
  like                  红心歌曲
  lyric                 获取歌曲歌词（逐行歌词、翻译歌词、非滚动歌词）

user                      用户相关命令
  album-history         获取最近播放专辑列表
  favorite              获取我的红心歌单
  history               获取最近播放歌曲列表
  info                  获取用户基本信息
  listen-ranking        听歌排行
  playlist-history      获取最近播放歌单列表
  radio-history         获取播单播放进度记录列表
  voice-history         获取最近播放声音列表
  voicebook-history     获取有声书播放进度记录列表