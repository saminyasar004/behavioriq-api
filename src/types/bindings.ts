import type { PrismaClient } from "@prisma/client";
import type { RedisClientType } from "redis";

export type AppVariables = {
	prisma: PrismaClient;
	redis: RedisClientType;
};
