package app.keylab.sound.uploads;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;

import app.keylab.shared.Ids;
import app.keylab.shared.UserId;
import app.keylab.shared.problem.ApiProblem;
import app.keylab.shared.problem.FieldError;
import app.keylab.shared.problem.ProblemTypes;
import app.keylab.sound.SoundApi;
import app.keylab.sound.storage.BlobStore;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Presigned uploads (ADM-04, US-38): a ticket with a signed URL, the file
 * itself, then one use. A sound upload becomes a recording; a switch photo
 * upload becomes the switch's photo (ADM-02 {@code photoUploadId}).
 */
@Service
public class Uploads implements SoundApi {

    /** "under 10 MB" on the drop zones. */
    public static final long MAX_BYTES = 10L * 1024 * 1024;
    static final Duration TICKET_LIFETIME = Duration.ofMinutes(15);
    static final int MIN_PHOTO_PX = 800;
    static final int MAX_FILE_NAME = 120;

    private static final Map<Upload.Purpose, Set<String>> TYPES = Map.of(
            Upload.Purpose.sound, Set.of("audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"),
            Upload.Purpose.switch_photo, Set.of("image/png", "image/jpeg"));

    private final UploadRepository uploads;
    private final UploadSigner signer;
    private final BlobStore blobs;
    private final String publicBase;
    private final Clock clock = Clock.systemUTC();

    Uploads(UploadRepository uploads, UploadSigner signer, BlobStore blobs,
            @Value("${keylab.storage.public-base}") String publicBase) {
        this.uploads = uploads;
        this.signer = signer;
        this.blobs = blobs;
        this.publicBase = publicBase.replaceAll("/+$", "");
    }

    /**
     * UploadTicket in openapi-v1.yaml: where to PUT the file, until when, and
     * the headers to send with it.
     */
    public record Ticket(UUID uploadId, String url, Instant expiresAt, Map<String, String> headers) {
    }

    /**
     * @throws ApiProblem 422 validation_failed (purpose, content type, size or file name)
     */
    public Ticket createTicket(String purpose, String contentType, Long bytes, String fileName, UserId editor) {
        Upload.Purpose kind = null;
        List<FieldError> errors = new java.util.ArrayList<>();
        try {
            kind = purpose == null ? null : Upload.Purpose.valueOf(purpose);
        }
        catch (IllegalArgumentException ex) {
            // Handled below.
        }
        if (kind == null) {
            errors.add(new FieldError("/purpose", "unsupported_purpose",
                    "avatar".equals(purpose) ? "Avatars are uploaded from the profile (ME-04)."
                            : "Use sound or switch_photo."));
        }
        String type = contentType == null ? "" : contentType.trim().toLowerCase(Locale.ROOT);
        if (kind != null && !TYPES.get(kind).contains(type)) {
            errors.add(new FieldError("/contentType", "unsupported_content_type",
                    kind == Upload.Purpose.sound ? "Upload a WAV file (audio/wav)." : "Upload a PNG or JPG."));
        }
        if (bytes != null && (bytes < 1 || bytes > MAX_BYTES)) {
            errors.add(new FieldError("/bytes", "file_too_large", "Files must be under 10 MB."));
        }
        if (fileName != null && (fileName.isBlank() || fileName.length() > MAX_FILE_NAME)) {
            errors.add(new FieldError("/fileName", "invalid_file_name",
                    "Use a file name of 1 to " + MAX_FILE_NAME + " characters."));
        }
        if (!errors.isEmpty()) {
            throw ApiProblem.validation(errors);
        }
        Instant now = clock.instant();
        Upload upload = new Upload(Ids.uuidV7(), kind, type, fileName == null ? null : fileName.strip(),
                Upload.Status.pending, null, null, editor.toString(), now, now.plus(TICKET_LIFETIME));
        uploads.insert(upload);
        Instant expires = upload.expiresAt();
        String url = publicBase + "/uploads/" + upload.id() + "?expires=" + expires.getEpochSecond() + "&signature="
                + URLEncoder.encode(signer.sign(upload.id(), Instant.ofEpochSecond(expires.getEpochSecond())),
                        StandardCharsets.US_ASCII);
        return new Ticket(upload.id(), url, expires, Map.of("Content-Type", type));
    }

    /**
     * The file for a ticket, PUT to its signed URL. A pending or received
     * upload can be sent again (a retry); a used one cannot.
     *
     * @throws ApiProblem 403 invalid_upload_signature, 403 upload_url_expired, 404 upload_not_found,
     *         409 upload_already_used, 422 file_too_large
     */
    public void receive(UUID uploadId, long expiresEpochSecond, String signature, InputStream body) {
        Instant expires = Instant.ofEpochSecond(expiresEpochSecond);
        if (!signer.verify(uploadId, expires, signature)) {
            throw ApiProblem.of(ProblemTypes.FORBIDDEN, "invalid_upload_signature",
                    "This upload URL is not valid. Ask for a new one.");
        }
        if (!clock.instant().isBefore(expires)) {
            throw ApiProblem.of(ProblemTypes.FORBIDDEN, "upload_url_expired",
                    "This upload URL has expired. Ask for a new one.");
        }
        Upload upload = uploads.find(uploadId).orElseThrow(Uploads::notFound);
        if (upload.status() == Upload.Status.used) {
            throw alreadyUsed();
        }
        MessageDigest sha;
        try {
            sha = MessageDigest.getInstance("SHA-256");
        }
        catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
        Limited limited = new Limited(new DigestInputStream(body, sha), MAX_BYTES);
        try {
            blobs.put(upload.blobKey(), limited);
        }
        catch (TooLarge ex) {
            throw ApiProblem.validation(List.of(new FieldError("", "file_too_large", "Files must be under 10 MB.")));
        }
        catch (IOException ex) {
            throw new IllegalStateException("Could not store upload " + uploadId, ex);
        }
        if (limited.count == 0) {
            throw ApiProblem.validation(List.of(new FieldError("", "empty_file", "The file is empty.")));
        }
        if (!uploads.received(uploadId, limited.count, HexFormat.of().formatHex(sha.digest()), clock.instant())) {
            throw alreadyUsed();
        }
    }

    /**
     * Takes a received sound upload for a recording, once. Runs in the
     * caller's transaction, which also writes the recording.
     *
     * @throws ApiProblem 422 validation_failed at {@code /uploadId}
     */
    @Transactional
    public Upload useSound(UUID uploadId) {
        Upload upload = take(uploadId, Upload.Purpose.sound, "/uploadId");
        uploads.used(upload.id());
        return upload;
    }

    /** The received file of an upload, for processing. */
    public Resource fileOf(UUID uploadId) {
        return file(uploads.find(uploadId).orElseThrow(() -> new IllegalStateException("No upload " + uploadId)));
    }

    /** SHA-256 of a received upload, hex: its content address. */
    public String sha256Of(UUID uploadId) {
        return uploads.find(uploadId).map(Upload::sha256)
            .orElseThrow(() -> new IllegalStateException("No upload " + uploadId));
    }

    private Resource file(Upload upload) {
        return blobs.get(upload.blobKey())
            .orElseThrow(() -> new IllegalStateException("Upload " + upload.id() + " has no file"));
    }

    @Override
    @Transactional
    public String usePhoto(UUID uploadId, String pointer) {
        Upload upload = take(uploadId, Upload.Purpose.switch_photo, pointer);
        String format = photoFormat(upload, pointer);
        String key = "photos/" + upload.sha256() + "." + ("png".equals(format) ? "png" : "jpg");
        try {
            blobs.copy(upload.blobKey(), key);
        }
        catch (IOException ex) {
            throw new IllegalStateException("Could not store photo " + uploadId, ex);
        }
        uploads.used(upload.id());
        return publicBase + "/assets/" + key;
    }

    private Upload take(UUID uploadId, Upload.Purpose purpose, String pointer) {
        Upload upload = uploads.lock(uploadId).orElse(null);
        if (upload == null) {
            throw invalid(pointer, "upload_not_found", "No upload with this id.");
        }
        if (upload.purpose() != purpose) {
            throw invalid(pointer, "upload_wrong_purpose", purpose == Upload.Purpose.sound
                    ? "This upload is not a sound." : "This upload is not a switch photo.");
        }
        if (upload.status() == Upload.Status.pending) {
            throw invalid(pointer, "upload_not_received", "The file has not arrived yet. Upload it first.");
        }
        if (upload.status() == Upload.Status.used) {
            throw invalid(pointer, "upload_already_used", "This upload is already in use. Upload the file again.");
        }
        return upload;
    }

    /** "png" or "jpeg", once the image is a square of at least 800 px. */
    private String photoFormat(Upload upload, String pointer) {
        Resource file = file(upload);
        try (ImageInputStream in = ImageIO.createImageInputStream(file.getInputStream())) {
            Iterator<ImageReader> readers = in == null ? null : ImageIO.getImageReaders(in);
            if (readers == null || !readers.hasNext()) {
                throw invalid(pointer, "photo_unreadable", "This file is not a PNG or JPG.");
            }
            ImageReader reader = readers.next();
            try {
                String format = reader.getFormatName().toLowerCase(Locale.ROOT);
                if (!format.equals("png") && !format.equals("jpeg")) {
                    throw invalid(pointer, "photo_unreadable", "This file is not a PNG or JPG.");
                }
                reader.setInput(in);
                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                if (width != height) {
                    throw invalid(pointer, "photo_not_square",
                            "The photo is " + width + " × " + height + " px. Crop it to a square.");
                }
                if (width < MIN_PHOTO_PX) {
                    throw invalid(pointer, "photo_too_small",
                            "The photo is " + width + " px wide. Use at least " + MIN_PHOTO_PX + " px.");
                }
                return format;
            }
            finally {
                reader.dispose();
            }
        }
        catch (IOException ex) {
            throw invalid(pointer, "photo_unreadable", "This file is not a PNG or JPG.");
        }
    }

    private static ApiProblem invalid(String pointer, String code, String message) {
        return ApiProblem.validation(List.of(new FieldError(pointer, code, message)));
    }

    private static ApiProblem notFound() {
        return ApiProblem.of(ProblemTypes.NOT_FOUND, "upload_not_found", "No upload with this id");
    }

    private static ApiProblem alreadyUsed() {
        return ApiProblem.of(ProblemTypes.CONFLICT, "upload_already_used",
                "This upload is already in use. Ask for a new upload URL.");
    }

    private static final class TooLarge extends IOException {
    }

    /** Counts what passes and stops one byte past the limit. */
    private static final class Limited extends FilterInputStream {

        private final long limit;
        long count;

        Limited(InputStream in, long limit) {
            super(in);
            this.limit = limit;
        }

        @Override
        public int read() throws IOException {
            int b = super.read();
            if (b >= 0) {
                add(1);
            }
            return b;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            int n = super.read(buffer, offset, length);
            if (n > 0) {
                add(n);
            }
            return n;
        }

        private void add(long n) throws TooLarge {
            count += n;
            if (count > limit) {
                throw new TooLarge();
            }
        }
    }
}
