package app.keylab.sound.web;

import java.io.IOException;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import app.keylab.shared.problem.ApiProblem;
import app.keylab.shared.problem.ProblemTypes;
import app.keylab.sound.storage.BlobStore;
import app.keylab.sound.uploads.Uploads;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The two file paths that stand in for an object store and its CDN:
 *
 * <ul>
 * <li>{@code PUT /v1/uploads/{upload_id}?expires=&signature=}: the presigned
 * URL from an ADM-04 ticket. The signature is the permission, as with an
 * object store, so it needs no token.</li>
 * <li>{@code GET /v1/assets/sounds/<sha256>.wav} and
 * {@code /v1/assets/photos/<sha256>.png|jpg}: content-addressed files, public
 * and cached for a year, since they never change.</li>
 * </ul>
 */
@RestController
class FileController {

    private static final Pattern ASSET = Pattern.compile("([0-9a-f]{64})\\.(wav|png|jpg)");
    private static final Map<String, MediaType> TYPES = Map.of("wav", MediaType.parseMediaType("audio/wav"),
            "png", MediaType.IMAGE_PNG, "jpg", MediaType.IMAGE_JPEG);
    private static final Map<String, String> KINDS = Map.of("sounds", "wav", "photos", "png|jpg");

    private final Uploads uploads;
    private final BlobStore blobs;

    FileController(Uploads uploads, BlobStore blobs) {
        this.uploads = uploads;
        this.blobs = blobs;
    }

    @PutMapping("/v1/uploads/{upload_id}")
    ResponseEntity<Void> upload(@PathVariable("upload_id") String uploadId, @RequestParam long expires,
            @RequestParam String signature, HttpServletRequest request) throws IOException {
        UUID id;
        try {
            id = UUID.fromString(uploadId);
        }
        catch (IllegalArgumentException ex) {
            throw ApiProblem.of(ProblemTypes.NOT_FOUND, "upload_not_found", "No upload with this id");
        }
        uploads.receive(id, expires, signature, request.getInputStream());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/v1/assets/{kind}/{name}")
    ResponseEntity<Resource> asset(@PathVariable String kind, @PathVariable String name) {
        Matcher matcher = ASSET.matcher(name);
        if (!KINDS.containsKey(kind) || !matcher.matches() || !matcher.group(2).matches(KINDS.get(kind))) {
            throw notFound();
        }
        Resource file = blobs.get(kind + "/" + name).orElseThrow(FileController::notFound);
        return ResponseEntity.ok()
            .cacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic().immutable())
            .contentType(TYPES.get(matcher.group(2)))
            .body(file);
    }

    private static ApiProblem notFound() {
        return ApiProblem.of(ProblemTypes.NOT_FOUND, "asset_not_found", "No file here");
    }
}
