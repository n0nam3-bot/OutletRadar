import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    productSearchConfigured: Boolean(process.env.API_SH_KEY),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    dailyPriceChecksConfigured: Boolean(process.env.API_SH_KEY && process.env.DATABASE_URL && process.env.CRON_SECRET),
  });
}
