export async function POST(req: Request) {
  void req;
  return Response.json(
    {
      ok: false,
      status: 410,
      message:
        "Deprecated upload endpoint. Use direct blob upload via /api/blob-upload and then POST metadata to /api/videos.",
    },
    { status: 410 }
  );
}

