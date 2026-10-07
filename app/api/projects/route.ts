import { listProjects } from "@/lib/store"

// GET /api/projects -> every film on this machine, for the switcher in the top bar.
export async function GET() {
  return Response.json(await listProjects())
}
