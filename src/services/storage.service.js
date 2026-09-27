const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require('../config/storage');

const createStorageError = (statusCode, code, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const getBucket = () => process.env.SUPABASE_STORAGE_BUCKET;

const uploadFile = async ({ key, body, contentType }) => {
  if (!key || typeof key !== 'string' || !key.trim()) {
    throw createStorageError(500, 'STORAGE_UPLOAD_FAILED', 'Storage upload failed');
  }

  const bucket = getBucket();
  if (!bucket) {
    throw createStorageError(500, 'STORAGE_UPLOAD_FAILED', 'Storage bucket is not configured');
  }

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    }));

    return { key, bucket };
  } catch (error) {
    const storageError = createStorageError(500, 'STORAGE_UPLOAD_FAILED', 'Storage upload failed');
    storageError.cause = error;
    throw storageError;
  }
};

const deleteFile = async ({ key }) => {
  if (!key || typeof key !== 'string' || !key.trim()) {
    throw createStorageError(500, 'STORAGE_DELETE_FAILED', 'Storage delete failed');
  }

  const bucket = getBucket();
  if (!bucket) {
    throw createStorageError(500, 'STORAGE_DELETE_FAILED', 'Storage bucket is not configured');
  }

  try {
    await s3Client.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: key
    }));

    return { key, bucket };
  } catch (error) {
    const storageError = createStorageError(500, 'STORAGE_DELETE_FAILED', 'Storage delete failed');
    storageError.cause = error;
    throw storageError;
  }
};

const getFileUrl = ({ key }) => {
  if (!key || typeof key !== 'string' || !key.trim()) {
    return null;
  }

  const publicBaseUrl = process.env.SUPABASE_STORAGE_PUBLIC_URL;
  if (!publicBaseUrl) {
    return null;
  }

  return `${publicBaseUrl.replace(/\/$/, '')}/${key.replace(/^\/+/, '')}`;
};

module.exports = {
  uploadFile,
  deleteFile,
  getFileUrl
};
