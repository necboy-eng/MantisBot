import * as lark from '@larksuiteoapi/node-sdk';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/loader.js';
import { getFileStorage } from '../../files/index.js';
import type { FileAttachment } from '../../types.js';
import { buildMarkdownCard } from './table-converter.js';

// 禁用代理环境变量，避免 EasyConnect/SSH Proxy 等导致重定向循环
// 这必须在导入 lark SDK 之前执行
if (!process.env.NO_PROXY) {
  process.env.NO_PROXY = '*.feishu.cn,*.larksuite.com,open.feishu.cn';
}
// 清除可能导致问题的代理设置
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.http_proxy;
delete process.env.https_proxy;
delete process.env.ALL_PROXY;
delete process.env.all_proxy;

// 使用 any 简化类型，避免复杂的 SDK 类型定义
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let wsClient: any = null;
// Bot 自身的 open_id，用于判断群聊中是否被 @到
let botOpenId: string | undefined;

// 消息去重缓存（参考 LobsterAI 实现）
const processedMessages = new Map<string, number>();
const MESSAGE_DEDUP_TTL = 5 * 60 * 1000; // 5 分钟

/**
 * 检查消息是否已处理过（去重）
 */
function isMessageProcessed(messageId: string): boolean {
  // 先清理过期消息
  cleanupProcessedMessages();

  if (processedMessages.has(messageId)) {
    return true;
  }
  processedMessages.set(messageId, Date.now());
  return false;
}

/**
 * 清理过期的已处理消息缓存
 */
function cleanupProcessedMessages(): void {
  const now = Date.now();
  for (const [messageId, timestamp] of processedMessages) {
    if (now - timestamp > MESSAGE_DEDUP_TTL) {
      processedMessages.delete(messageId);
    }
  }
}

/**
 * 解析域名配置
 */
function resolveDomain(domain: string | undefined): any {
  if (!domain || domain === 'feishu') return lark.Domain.Feishu;
  if (domain === 'lark') return lark.Domain.Lark;
  // 自定义域名（移除末尾斜杠）
  return domain.replace(/\/+$/, '');
}

/**
 * 探测 Bot 信息，验证配置是否正确
 * 参考 LobsterAI 实现
 */
async function probeBot(): Promise<{ ok: boolean; error?: string; botName?: string; botOpenId?: string }> {
  if (!client) {
    return { ok: false, error: 'Client not initialized' };
  }

  try {
    console.log('[Feishu] Probing bot info...');
    const response: any = await client.request({
      method: 'GET',
      url: '/open-apis/bot/v3/info',
    });

    console.log('[Feishu] Bot probe response:', JSON.stringify(response));

    if (response.code !== 0) {
      return { ok: false, error: response.msg || `code ${response.code}` };
    }

    return {
      ok: true,
      botName: response.bot?.app_name ?? response.data?.app_name ?? response.data?.bot?.app_name,
      botOpenId: response.bot?.open_id ?? response.data?.open_id ?? response.data?.bot?.open_id,
    };
  } catch (err: any) {
    console.error('[Feishu] Bot probe failed:', err.message);
    return { ok: false, error: err.message };
  }
}

export function getFeishuClient(): typeof client {
  const config = getConfig();
  // 从新架构的 config.channels.feishu 读取配置
  const feishuConfig = (config.channels as any)?.feishu;
  if (!feishuConfig?.enabled) {
    console.warn('[Feishu] getFeishuClient: feishu not enabled in config.channels.feishu');
    return null;
  }

  if (!client) {
    const appId = feishuConfig.appId || '';
    const appSecret = feishuConfig.appSecret || '';
    const domain = resolveDomain(feishuConfig.domain);

    if (!appId || !appSecret) {
      console.warn('[Feishu] Missing appId or appSecret in config.channels.feishu');
      return null;
    }
    console.log('[Feishu] Creating Lark client, appId:', appId, 'domain:', feishuConfig.domain || 'feishu');
    client = new lark.Client({
      appId,
      appSecret,
      appType: lark.AppType.SelfBuild,
      domain,
    });
  }

  return client;
}

export function isFeishuEnabled(): boolean {
  const config = getConfig();
  // 同时兼容新配置路径（config.channels.feishu）和旧配置路径（config.feishu）
  const newPath = (config.channels as any)?.feishu?.enabled ?? false;
  const oldPath = (config as any).feishu?.enabled ?? false;
  const result = newPath || oldPath;
  console.log(`[Feishu] isFeishuEnabled: channels.feishu.enabled=${newPath}, feishu.enabled=${oldPath}, result=${result}`);
  return result;
}

/**
 * 启动飞书长连接 WebSocket 客户端
 * 用于接收实时消息事件
 * 参考 LobsterAI 实现，增加预检测和域名配置
 */
export async function startFeishuWSClient(
  onMessage: (message: string, chatId: string, userId: string, messageId: string) => Promise<void>
): Promise<void> {
  const config = getConfig();
  // 从新架构的 config.channels.feishu 读取配置
  const feishuConfig = (config.channels as any)?.feishu;

  console.log('[Feishu] startFeishuWSClient called');
  console.log('[Feishu] config.channels?.feishu:', JSON.stringify({ ...feishuConfig, appSecret: '***' }));
  console.log('[Feishu] (legacy) config.feishu:', JSON.stringify({ ...(config as any).feishu, appSecret: '***' }));

  if (!feishuConfig?.enabled) {
    console.log('[Feishu] Integration is disabled (config.channels.feishu.enabled is falsy)');
    return;
  }

  const appId = feishuConfig.appId || '';
  const appSecret = feishuConfig.appSecret || '';
  if (!appId || !appSecret) {
    console.warn('[Feishu] Missing appId or appSecret in config.channels.feishu, skipping WebSocket client');
    return;
  }

  const domain = resolveDomain(feishuConfig.domain);
  const debug = feishuConfig.debug ?? false;

  // 确保创建 REST client（用于发送消息和预检测）
  if (!client) {
    client = new lark.Client({
      appId,
      appSecret,
      appType: lark.AppType.SelfBuild,
      domain,
    });
  }

  // 预检测 Bot 配置是否正确（参考 LobsterAI）
  const probeResult = await probeBot();
  if (!probeResult.ok) {
    console.error(`[Feishu] Bot probe failed: ${probeResult.error}`);
    console.error('[Feishu] Please check your appId and appSecret configuration');
    return;
  }
  console.log(`[Feishu] Bot verified: ${probeResult.botName} (${probeResult.botOpenId})`);
  botOpenId = probeResult.botOpenId;

  // 创建 WSClient 用于长连接
  console.log('[Feishu] Creating WebSocket client, domain:', feishuConfig.domain || 'feishu');
  wsClient = new lark.WSClient({
    appId,
    appSecret,
    domain,
    loggerLevel: debug ? lark.LoggerLevel.debug : lark.LoggerLevel.info,
  });

  console.log('[Feishu] Starting WebSocket client...');
  console.log('[Feishu] AppId:', appId);

  wsClient.start({
    eventDispatcher: new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: any) => {
        const message = data.message;
        const messageId = message.message_id;

        // 消息去重检查（参考 LobsterAI）
        if (isMessageProcessed(messageId)) {
          console.log(`[Feishu] Duplicate message ignored: ${messageId}`);
          return;
        }

        console.log('[Feishu] Full message data:', JSON.stringify(data, null, 2));

        // 群聊消息：只处理 Bot 本身被 @到的消息，忽略普通群消息
        const isGroupChat = message.chat_type === 'group';
        if (isGroupChat) {
          const mentions: any[] = Array.isArray(message.mentions) ? message.mentions : [];
          const isBotMentioned = mentions.some(
            (m: any) =>
              m.id?.open_id === botOpenId ||
              m.id?.union_id === botOpenId ||
              m.id?.user_id === botOpenId
          );
          if (!isBotMentioned) {
            console.log(`[Feishu] Group message without @bot ignored: ${messageId}`);
            return;
          }
        }

        const chatId = message.chat_id;
        // sender_id 结构可能因应用类型不同而有差异
        const userId = message.sender_id?.user_id || message.sender_id?.union_id || '';

        // 解析消息内容，并清除 @_user_X 占位符
        let content = '';
        try {
          content = JSON.parse(message.content || '{}').text || '';
        } catch {
          content = message.content || '';
        }
        // 移除飞书 @占位符（如 "@_user_1 "），保留实际文字
        content = content.replace(/@_user_\d+\s*/g, '').trim();

        console.log(`[Feishu] Received message from ${userId}, chatId: ${chatId}, messageId: ${messageId}, content: ${content}`);

        // 调用传入的回调函数处理消息
        if (onMessage) {
          await onMessage(content, chatId, userId, messageId);
        }
      },
      // 添加消息已读事件处理器，消除警告
      'im.message.message_read_v1': async () => {
        // 忽略已读回执
      },
    }),
  });

  console.log('[Feishu] WebSocket client started');
}

export { buildMarkdownCard } from './table-converter.js';

/**
 * 回复指定消息（引用原消息，适用于群聊 @Bot 场景）
 * @param replyToMessageId 被回复的原始消息 ID
 * @param content 回复内容（支持 Markdown 格式）
 * @param title 可选的卡片标题
 */
export async function replyFeishuMessage(
  replyToMessageId: string,
  content: string,
  title?: string
): Promise<void> {
  const feishu = getFeishuClient();
  if (!feishu) {
    throw new Error('Feishu is not enabled');
  }

  await feishu.im.v1.message.reply({
    path: { message_id: replyToMessageId },
    data: {
      content: buildMarkdownCard(content, title),
      msg_type: 'interactive',
    },
  });
}

/**
 * 发送消息到飞书（支持 Markdown 格式）
 * @param chatId 群聊 ID
 * @param content 消息内容（支持 Markdown 格式）
 * @param title 可选的卡片标题
 */
export async function sendFeishuMessage(
  chatId: string,
  content: string,
  title?: string
): Promise<void> {
  const feishu = getFeishuClient();
  if (!feishu) {
    throw new Error('Feishu is not enabled');
  }

  await feishu.im.v1.message.create({
    params: {
      receive_id_type: 'chat_id',
    },
    data: {
      receive_id: chatId,
      content: buildMarkdownCard(content, title),
      msg_type: 'interactive',
    },
  });
}

/**
 * 发送消息给指定用户（支持 Markdown 格式）
 * @param userId 用户 ID
 * @param content 消息内容（支持 Markdown 格式）
 * @param title 可选的卡片标题
 */
export async function sendFeishuUserMessage(
  userId: string,
  content: string,
  title?: string
): Promise<void> {
  const feishu = getFeishuClient();
  if (!feishu) {
    throw new Error('Feishu is not enabled');
  }

  await feishu.im.v1.message.create({
    params: {
      receive_id_type: 'user_id',
    },
    data: {
      receive_id: userId,
      content: buildMarkdownCard(content, title),
      msg_type: 'interactive',
    },
  });
}

/**
 * 上传文件到飞书并发送给群聊
 * 飞书发送文件需要先上传获取 file_key，再发送文件消息
 * attachment.url 格式为 /api/files/{uuid}.ext，对应磁盘 data/uploads/{uuid}.ext
 */
export async function sendFeishuFile(
  chatId: string,
  attachment: FileAttachment
): Promise<void> {
  const feishu = getFeishuClient();
  if (!feishu) {
    throw new Error('Feishu is not enabled');
  }

  // 从 FileStorage 按 url 读取文件内容
  // url 格式：/api/files/{uuid}.ext → storedName = {uuid}.ext
  const storedName = path.basename(attachment.url);
  const fileStorage = getFileStorage();
  const fileData = fileStorage.readFile(storedName);

  if (!fileData) {
    console.warn(`[Feishu] Cannot read file from storage: ${attachment.url}, skipping`);
    return;
  }

  const mime = attachment.mimeType || '';

  if (mime.startsWith('image/')) {
    // 图片走 image.create 接口（不带 .v1，参考 OpenClaw 实现）
    console.log(`[Feishu] Uploading image: ${attachment.name} (${fileData.length} bytes)`);
    const uploadResp = await feishu.im.image.create({
      data: { image_type: 'message', image: fileData },
    });
    // SDK v1.30+ 成功时直接返回数据，无 code 包装
    const respAny = uploadResp as any;
    const imageKey = respAny.image_key ?? respAny.data?.image_key;
    if (!imageKey) {
      console.warn('[Feishu] Image upload failed, no image_key returned. Response:', JSON.stringify(respAny));
      return;
    }
    console.log(`[Feishu] Image uploaded, key: ${imageKey}`);
    await feishu.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        content: JSON.stringify({ image_key: imageKey }),
        msg_type: 'image',
      },
    });
    return;
  }

  // 非图片文件：从文件名扩展名映射飞书 file_type（与 MIME 相比更准确）
  const ext = attachment.name.toLowerCase().split('.').pop() || '';
  let fileType: string;
  if (ext === 'pdf') fileType = 'pdf';
  else if (ext === 'doc' || ext === 'docx') fileType = 'doc';
  else if (ext === 'xls' || ext === 'xlsx') fileType = 'xls';
  else if (ext === 'ppt' || ext === 'pptx') fileType = 'ppt';
  else if (ext === 'mp4' || ext === 'mov' || ext === 'avi') fileType = 'mp4';
  else if (ext === 'opus' || ext === 'ogg') fileType = 'opus';
  else fileType = 'stream';

  console.log(`[Feishu] Uploading file: ${attachment.name} (${fileType}, ${fileData.length} bytes)`);
  // 使用 client.im.file.create（不带 .v1），参考 OpenClaw 实现
  const uploadResp = await feishu.im.file.create({
    data: {
      file_type: fileType,
      file_name: attachment.name,
      file: fileData as any,
    },
  });

  // SDK v1.30+ 成功时直接返回数据，无 code 包装；失败时有 code 字段
  const respAny = uploadResp as any;
  if (respAny.code !== undefined && respAny.code !== 0) {
    throw new Error(`Feishu file upload failed: ${respAny.msg || `code ${respAny.code}`}`);
  }
  const fileKey = respAny.file_key ?? respAny.data?.file_key;
  if (!fileKey) {
    console.warn('[Feishu] File upload failed, no file_key returned. Response:', JSON.stringify(respAny));
    return;
  }

  const isMedia = fileType === 'mp4' || fileType === 'opus';
  console.log(`[Feishu] File uploaded, key: ${fileKey}, sending as msg_type=${isMedia ? 'media' : 'file'}...`);
  await feishu.im.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: chatId,
      content: JSON.stringify({ file_key: fileKey }),
      msg_type: isMedia ? 'media' : 'file',
    },
  });
  console.log(`[Feishu] File message sent: ${attachment.name}`);
}

/**
 * 关闭飞书长连接
 */
export function stopFeishuWSClient(): void {
  if (wsClient) {
    wsClient.close();
    wsClient = null;
    console.log('[Feishu] WebSocket client stopped');
  }
}

/**
 * 获取飞书客户端（复用工具模块的客户端管理器）
 */
export async function getFeishuClientForTools(userId?: string): Promise<any> {
  // 动态导入并使用工具模块的客户端管理器
  const feishuModule = await import('../../agents/tools/feishu/client.js');
  return feishuModule.getFeishuClient(userId);
}
