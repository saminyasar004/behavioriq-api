import type { PrismaClient } from "../prisma";
import type { RedisClientType } from "redis";

export type AppVariables = {
	prisma: PrismaClient;
	redis: RedisClientType;
};
