export async function register() {
  const url = process.env.DATABASE_URL?.trim();
  console.log("DATABASE_URL present:", !!url);
  if (url && process.env.NODE_ENV !== "production") {
    try {
      const u = new URL(url);
      u.password = "***";
      u.username = u.username ? "***" : "";
      console.log("DATABASE_URL format (safe):", u.toString());
    } catch {
      console.log("DATABASE_URL format: (parse skip)");
    }
  }
}
