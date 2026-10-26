import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/current";

export default async function Home() {
  const actor = await getActor();
  redirect(!actor ? "/login" : actor.kind === "CUSTOMER" ? "/portal" : "/dashboard");
}
