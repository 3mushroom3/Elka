import { redirect } from "next/navigation";
import { getCurrentUser, homePath } from "@/lib/auth";

export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? homePath(user.role) : "/login");
}
