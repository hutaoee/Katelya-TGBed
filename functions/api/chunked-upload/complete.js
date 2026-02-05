/**
 * 完成分片上传
 * POST /api/chunked-upload/complete
 */
import { checkAuthentication, isAuthRequired } from '../../utils/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    // 检查认证
    if (isAuthRequired(env)) {
      const auth = await checkAuthentication(context);
      if (!auth.authenticated) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
          status: 401, 
          headers: { 'Content-Type': 'application/json' } 
        });
      }
    }

    const body = await request.json();
    const { uploadId } = body;

    if (!uploadId) {
      return new Response(JSON.stringify({ error: '缺少 uploadId' }), { 
        status: 400, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    // 获取上传任务
    const taskData = await env.img_url.get(`upload:${uploadId}`, { type: 'json' });
    if (!taskData) {
      return new Response(JSON.stringify({ error: '上传任务不存在或已过期' }), { 
        status: 404, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    // 检查所有分片是否都已上传
    if (taskData.uploadedChunks.length !== taskData.totalChunks) {
      return new Response(JSON.stringify({ 
        error: '分片未完全上传',
        uploaded: taskData.uploadedChunks.length,
        total: taskData.totalChunks,
        missingChunks: getMissingChunks(taskData.uploadedChunks, taskData.totalChunks)
      }), { 
        status: 400, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    // 合并所有分片
    const chunks = [];
    for (let i = 0; i < taskData.totalChunks; i++) {
      const chunkData = await env.img_url.get(`chunk:${uploadId}:${i}`, { type: 'arrayBuffer' });
      if (!chunkData) {
        return new Response(JSON.stringify({ error: `分片 ${i} 数据丢失` }), { 
          status: 500, 
          headers: { 'Content-Type': 'application/json' } 
        });
      }
      chunks.push(chunkData);
    }

    // 合并为完整文件
    const completeFile = new Blob(chunks, { type: taskData.fileType });
    const file = new File([completeFile], taskData.fileName, { type: taskData.fileType });

    // 获取文件扩展名
    const fileExtension = taskData.fileName.split('.').pop().toLowerCase();

    let fileKey = null;
    let storageType = taskData.storageMode === 'r2' ? 'r2' : 'telegram';

    // 优先根据 storageMode 上传到 R2
    if (storageType === 'r2') {
      if (!env.R2_BUCKET) {
        return new Response(JSON.stringify({ error: 'R2 未配置，无法完成上传' }), { 
          status: 500, 
          headers: { 'Content-Type': 'application/json' } 
        });
      }
      const uploadResult = await uploadToR2(file, fileExtension, env);
      fileKey = uploadResult.fileKey;
      storageType = 'r2';
    } else {
      // 上传到 Telegram
      const result = await uploadToTelegram(file, env);

      if (!result.success) {
        return new Response(JSON.stringify({ error: result.error }), { 
          status: 500, 
          headers: { 'Content-Type': 'application/json' } 
        });
      }
      fileKey = `${result.fileId}.${fileExtension}`;
      taskData.telegramMessageId = result.messageId || taskData.telegramMessageId;
    }

    // 保存文件信息到 KV
    await env.img_url.put(fileKey, "", {
      metadata: {
        TimeStamp: Date.now(),
        ListType: "None",
        Label: "None",
        liked: false,
        fileName: taskData.fileName,
        fileSize: taskData.fileSize,
        chunked: true,
        totalChunks: taskData.totalChunks,
        storageType,
        r2Key: storageType === 'r2' ? fileKey.replace(/^r2:/, '') : undefined,
        telegramMessageId: storageType === 'telegram' ? taskData.telegramMessageId : undefined
      }
    });

    // 清理临时数据
    await cleanupUploadTask(uploadId, taskData.totalChunks, env);

    return new Response(JSON.stringify({
      success: true,
      src: `/file/${fileKey}`,
      fileName: taskData.fileName,
      fileSize: taskData.fileSize
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Complete upload error:', error);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}

function getMissingChunks(uploaded, total) {
  const missing = [];
  for (let i = 0; i < total; i++) {
    if (!uploaded.includes(i)) {
      missing.push(i);
    }
  }
  return missing;
}

async function cleanupUploadTask(uploadId, totalChunks, env) {
  try {
    // 删除任务记录
    await env.img_url.delete(`upload:${uploadId}`);
    // 删除所有分片
    for (let i = 0; i < totalChunks; i++) {
      await env.img_url.delete(`chunk:${uploadId}:${i}`);
    }
  } catch (e) {
    console.error('Cleanup error:', e);
  }
}

async function uploadToTelegram(file, env) {
  const formData = new FormData();
  formData.append("chat_id", env.TG_Chat_ID);

  // 根据文件类型选择 API
  let apiEndpoint;
  if (file.type.startsWith('image/')) {
    formData.append("photo", file);
    apiEndpoint = 'sendPhoto';
  } else if (file.type.startsWith('audio/')) {
    formData.append("audio", file);
    apiEndpoint = 'sendAudio';
  } else if (file.type.startsWith('video/')) {
    formData.append("video", file);
    apiEndpoint = 'sendVideo';
  } else {
    formData.append("document", file);
    apiEndpoint = 'sendDocument';
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${env.TG_Bot_Token}/${apiEndpoint}`,
      { method: "POST", body: formData }
    );
    const data = await response.json();

    if (!response.ok || !data.ok) {
      // 如果是图片上传失败，尝试作为文档上传
      if (apiEndpoint === 'sendPhoto') {
        const docFormData = new FormData();
        docFormData.append("chat_id", env.TG_Chat_ID);
        docFormData.append("document", file);
        const docResponse = await fetch(
          `https://api.telegram.org/bot${env.TG_Bot_Token}/sendDocument`,
          { method: "POST", body: docFormData }
        );
        const docData = await docResponse.json();
        if (docResponse.ok && docData.ok) {
          return { success: true, fileId: getFileId(docData), messageId: docData?.result?.message_id };
        }
      }
      return { success: false, error: data.description || 'Upload failed' };
    }

    return { success: true, fileId: getFileId(data), messageId: data?.result?.message_id };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function uploadToR2(file, fileExtension, env) {
  const fileId = `r2_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const objectKey = `${fileId}.${fileExtension}`;
  const arrayBuffer = await file.arrayBuffer();

  await env.R2_BUCKET.put(objectKey, arrayBuffer, {
    httpMetadata: {
      contentType: file.type || 'application/octet-stream'
    },
    customMetadata: {
      fileName: file.name,
      uploadTime: Date.now().toString()
    }
  });

  return { fileKey: `r2:${objectKey}` };
}

function getFileId(response) {
  if (!response.ok || !response.result) return null;
  const result = response.result;
  
  if (result.photo) {
    return result.photo.reduce((prev, current) =>
      (prev.file_size > current.file_size) ? prev : current
    ).file_id;
  }
  if (result.document) return result.document.file_id;
  if (result.video) return result.video.file_id;
  if (result.audio) return result.audio.file_id;
  
  return null;
}
