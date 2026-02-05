export async function onRequest(context) {
    const { env, params } = context;
    const fileId = params.id;
    console.log('Deleting file:', fileId);
    
    try {
      // 优先读取 KV 元数据，判断存储类型与 Telegram 信息
      let record = null;
      if (env.img_url) {
        const prefixes = ['img:', 'vid:', 'aud:', 'doc:', 'r2:', ''];
        for (const prefix of prefixes) {
          const key = `${prefix}${fileId}`;
          record = await env.img_url.getWithMetadata(key);
          if (record && record.metadata) break;
        }
      }

      const metadata = record?.metadata || {};
      const isR2 = fileId.startsWith('r2:') || metadata.storageType === 'r2' || metadata.storage === 'r2';

      // R2 文件：先删对象，再删 KV
      if (isR2) {
        const r2Key = metadata.r2Key || fileId.replace('r2:', '');
        if (!env.R2_BUCKET) {
          throw new Error('R2 未配置，无法删除对象');
        }
        await env.R2_BUCKET.delete(r2Key);
        if (env.img_url) {
          await env.img_url.delete(fileId);
        }

        return new Response(JSON.stringify({ 
          success: true, 
          message: '已从 R2 与 KV 删除',
          fileId
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Telegram 文件：尝试删除消息（需要 metadata.telegramMessageId）
      let telegramDeleted = false;
      if (metadata.telegramMessageId) {
        telegramDeleted = await deleteTelegramMessage(metadata.telegramMessageId, env);
      }

      if (!telegramDeleted) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Telegram 删除失败或缺少 messageId，已阻止伪删除'
        }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Telegram 删除成功后再删除 KV
      if (env.img_url) {
        await env.img_url.delete(fileId);
      }

      return new Response(JSON.stringify({ 
        success: true, 
        message: '已从 Telegram 与 KV 删除',
        fileId
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      console.error('Delete error:', error);
      return new Response(JSON.stringify({ 
        success: false, 
        error: error.message 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

async function deleteTelegramMessage(messageId, env) {
  if (!env.TG_Bot_Token || !env.TG_Chat_ID) return false;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${env.TG_Bot_Token}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TG_Chat_ID,
        message_id: messageId
      })
    });
    const data = await resp.json();
    return resp.ok && data.ok;
  } catch (error) {
    console.error('Telegram delete message error:', error);
    return false;
  }
}