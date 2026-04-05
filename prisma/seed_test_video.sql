INSERT INTO "Video" (id, "originalName", url, size, mime, "createdAt")
VALUES (1, 'test video', '/videos/test.mp4', 0, 'video/mp4', CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;
