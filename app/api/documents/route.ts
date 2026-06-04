import { NextResponse } from "next/server";
import { listDocuments } from "@/lib/db/documents";

export async function GET() {
  const documents = await listDocuments();
  return NextResponse.json({ documents });
}
