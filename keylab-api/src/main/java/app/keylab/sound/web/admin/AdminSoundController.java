package app.keylab.sound.web.admin;

import java.net.URI;
import java.util.UUID;

import app.keylab.shared.UserId;
import app.keylab.shared.idempotency.IdempotencyKeys;
import app.keylab.shared.idempotency.IdempotencyKeys.Stored;
import app.keylab.shared.paging.PageQuery;
import app.keylab.shared.paging.PageResult;
import app.keylab.shared.problem.ApiProblem;
import app.keylab.shared.problem.ProblemTypes;
import app.keylab.shared.security.Roles;
import app.keylab.sound.recordings.Recordings;
import app.keylab.sound.recordings.SoundRecording;
import app.keylab.sound.uploads.Uploads;
import app.keylab.sound.uploads.Uploads.Ticket;

import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * ADM-04 (US-38): a presigned upload URL, then attach the uploaded WAV to a
 * switch as {@code { uploadId, variant, stroke }}, answered 202 while
 * processing runs. ADM-05: recordings by status or switch, one recording to
 * poll, and delete a bad take. Editor and up.
 */
@RestController
@PreAuthorize("hasRole('" + Roles.EDITOR + "')")
class AdminSoundController {

    private static final CacheControl PRIVATE = CacheControl.noStore().cachePrivate();

    private final Uploads uploads;
    private final Recordings recordings;
    private final IdempotencyKeys idempotencyKeys;
    private final JsonMapper json;

    AdminSoundController(Uploads uploads, Recordings recordings, IdempotencyKeys idempotencyKeys, JsonMapper json) {
        this.uploads = uploads;
        this.recordings = recordings;
        this.idempotencyKeys = idempotencyKeys;
        this.json = json;
    }

    /** UploadRequest in openapi-v1.yaml. */
    record UploadRequest(String purpose, String contentType, Long bytes, String fileName) {
    }

    @PostMapping(path = "/v1/admin/uploads", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<String> ticket(@RequestBody UploadRequest body,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @AuthenticationPrincipal Jwt jwt) {
        UserId editor = UserId.of(jwt);
        Stored result = idempotencyKeys.execute("sound-uploads:" + editor, idempotencyKey,
                IdempotencyKeys.hash(json.writeValueAsString(body)), () -> {
                    Ticket ticket = uploads.createTicket(body.purpose(), body.contentType(), body.bytes(),
                            body.fileName(), editor);
                    return new Stored(201, null, json.writeValueAsString(ticket));
                });
        return ResponseEntity.status(result.status()).cacheControl(PRIVATE).contentType(MediaType.APPLICATION_JSON)
            .body(result.body());
    }

    @PostMapping(path = "/v1/admin/switches/{id}/sounds", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<String> attach(@PathVariable String id, @RequestBody JsonNode body,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @AuthenticationPrincipal Jwt jwt) {
        UUID switchId = switchId(id);
        UserId editor = UserId.of(jwt);
        Stored result = idempotencyKeys.execute("sound-attach:" + editor + ":" + switchId, idempotencyKey,
                IdempotencyKeys.hash(json.writeValueAsString(body)), () -> {
                    SoundRecording recording = recordings.attach(switchId, body, editor);
                    return new Stored(202, "/v1/admin/sounds/" + recording.id(),
                            json.writeValueAsString(AdminSound.of(recording)));
                });
        return ResponseEntity.status(result.status()).cacheControl(PRIVATE).contentType(MediaType.APPLICATION_JSON)
            .location(URI.create(result.location())).body(result.body());
    }

    @GetMapping("/v1/admin/sounds")
    ResponseEntity<PageResult<AdminSound>> list(@RequestParam(required = false) String status,
            @RequestParam(name = "switch_id", required = false) String switchId, PageQuery page) {
        SoundRecording.Status wanted = null;
        if (status != null) {
            try {
                wanted = SoundRecording.Status.valueOf(status);
            }
            catch (IllegalArgumentException ex) {
                throw ApiProblem.of(ProblemTypes.BAD_REQUEST, "invalid_parameter",
                        "status must be processing, ready or failed");
            }
        }
        UUID forSwitch = null;
        if (switchId != null) {
            try {
                forSwitch = UUID.fromString(switchId);
            }
            catch (IllegalArgumentException ex) {
                throw ApiProblem.of(ProblemTypes.BAD_REQUEST, "invalid_parameter", "switch_id must be a switch id");
            }
        }
        return ResponseEntity.ok().cacheControl(PRIVATE)
            .body(recordings.list(wanted, forSwitch, page).map(AdminSound::of));
    }

    @GetMapping("/v1/admin/sounds/{id}")
    ResponseEntity<AdminSound> get(@PathVariable String id) {
        return ResponseEntity.ok().cacheControl(PRIVATE).body(AdminSound.of(recordings.get(soundId(id))));
    }

    @DeleteMapping("/v1/admin/sounds/{id}")
    ResponseEntity<Void> delete(@PathVariable String id) {
        recordings.delete(soundId(id));
        return ResponseEntity.noContent().build();
    }

    private static UUID switchId(String id) {
        try {
            return UUID.fromString(id);
        }
        catch (IllegalArgumentException ex) {
            throw ApiProblem.of(ProblemTypes.NOT_FOUND, "switch_not_found", "No switch with this id");
        }
    }

    private static UUID soundId(String id) {
        try {
            return UUID.fromString(id);
        }
        catch (IllegalArgumentException ex) {
            throw ApiProblem.of(ProblemTypes.NOT_FOUND, "sound_not_found", "No recording with this id");
        }
    }
}
