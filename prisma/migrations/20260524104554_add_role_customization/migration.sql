-- CreateTable
CREATE TABLE "role_customizations" (
    "role" "BuiltInRole" NOT NULL,
    "capId" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,

    CONSTRAINT "role_customizations_pkey" PRIMARY KEY ("role","capId")
);
