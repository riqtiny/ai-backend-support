import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await prisma.organization.upsert({
    where: { apiKey: "demo-org-key" },
    update: { name: "Demo Organization" },
    create: {
      name: "Demo Organization",
      apiKey: "demo-org-key",
    },
  });

  console.log("Seeded demo organization (API key: demo-org-key)");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
