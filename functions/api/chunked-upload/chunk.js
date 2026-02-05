/**
 * 上传分片
 * POST /api/chunked-upload/chunk
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

    const formData = await request.formData();
    const uploadId = formData.get('uploadId');
    const chunkIndex = parseInt(formData.get('chunkIndex'));
    const chunk = formData.get('chunk');

    if (!uploadId || isNaN(chunkIndex) || !chunk) {
      return new Response(JSON.stringify({ error: '缺少必要参数' }), { 
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

    // 检查分片是否已上传
    if (taskData.uploadedChunks.includes(chunkIndex)) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: '分片已存在',
        uploadedChunks: taskData.uploadedChunks
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 将分片数据存储到 KV（临时存储）
    const chunkArrayBuffer = await chunk.arrayBuffer();
    await env.img_url.put(`chunk:${uploadId}:${chunkIndex}`, chunkArrayBuffer, {
      expirationTtl: 3600,
      metadata: {
        type: 'chunk',
        uploadId,
        chunkIndex,
        createdAt: Date.now()
      }
    });

    // 更新任务状态
    taskData.uploadedChunks.push(chunkIndex);
    taskData.uploadedChunks.sort((a, b) => a - b);
    await env.img_url.put(`upload:${uploadId}`, JSON.stringify(taskData), {
      expirationTtl: 3600
    });

    return new Response(JSON.stringify({
      success: true,
      chunkIndex,
      uploadedChunks: taskData.uploadedChunks,
      progress: (taskData.uploadedChunks.length / taskData.totalChunks * 100).toFixed(1)
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Chunk upload error:', error);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}
