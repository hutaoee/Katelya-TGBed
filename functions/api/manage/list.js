export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const raw = url.searchParams.get("limit");
  let limit = parseInt(raw || "100", 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 100;
  if (limit > 1000) limit = 1000;

  const cursor = url.searchParams.get("cursor") || undefined;
  const prefix = url.searchParams.get("prefix") || undefined;
  const storageFilter = url.searchParams.get("storage") || undefined; // 'kv', 'r2', or undefined for all
  
  const value = await env.img_url.list({ limit, cursor, prefix });

  const invalidPrefixes = ['session:', 'chunk:', 'upload:', 'temp:'];
  const isValidKey = (key) => {
    if (!key?.name) return false;
    if (invalidPrefixes.some(prefix => key.name.startsWith(prefix))) return false;
    const metadata = key.metadata || {};
    return Boolean(metadata.fileName) && metadata.TimeStamp !== undefined && metadata.TimeStamp !== null;
  };

  // 过滤掉会话缓存、分片临时键等无效条目，并要求完整元数据
  const sanitizedKeys = value.keys.filter(isValidKey);

  // 为每个文件添加存储类型标识
  const keysWithStorageType = sanitizedKeys.map(key => {
    const isR2 = key.name.startsWith('r2:');
    return {
      ...key,
      metadata: {
        ...key.metadata,
        storageType: isR2 ? 'r2' : 'telegram'
      }
    };
  });

  // 如果指定了存储类型过滤
  let filteredKeys = keysWithStorageType;
  if (storageFilter === 'r2') {
    filteredKeys = keysWithStorageType.filter(key => key.name.startsWith('r2:'));
  } else if (storageFilter === 'kv' || storageFilter === 'telegram') {
    filteredKeys = keysWithStorageType.filter(key => !key.name.startsWith('r2:'));
  }

  return new Response(JSON.stringify({
    ...value,
    keys: filteredKeys
  }), {
    headers: { "Content-Type": "application/json" }
  });
}