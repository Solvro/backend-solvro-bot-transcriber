import { logger } from "@utils/logger";
import { minioClient } from "@utils/minio";

export const uploadFile = async (sourceFilePath: string, destinationBucket: string, destinationFileName: string) => {
    const exists = await minioClient.bucketExists(destinationBucket);

    if (!exists) {
        logger.info("Creating new bucket");
        await minioClient.makeBucket(destinationBucket);
    }

    logger.info("Uploading file to storrage");

    await minioClient.fPutObject(destinationBucket, destinationFileName, sourceFilePath);

    logger.info("File upload complete");
};