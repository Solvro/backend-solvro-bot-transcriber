import * as Minio from 'minio'

export const minioClient = new Minio.Client({
    endPoint: process.env.BUCKET_ENDPOINT || 'localhost',
    port: 9000,
    useSSL: process.env.BUCKET_ENDPOINT ? true : false,
    accessKey: process.env.BUCKET_ACCESS_KEY,
    secretKey: process.env.BUCKET_SECRET_KEY,
})