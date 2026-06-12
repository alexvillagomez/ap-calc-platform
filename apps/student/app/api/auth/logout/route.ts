/**
 * POST /api/auth/logout
 *
 * Clears the "lodera_uid" httpOnly cookie.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const COOKIE_NAME = "lodera_uid";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return NextResponse.json({ ok: true });
}
