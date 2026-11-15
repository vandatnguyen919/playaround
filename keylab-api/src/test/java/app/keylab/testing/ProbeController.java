package app.keylab.testing;

import java.util.List;
import java.util.stream.IntStream;

import app.keylab.shared.concurrency.ETags;
import app.keylab.shared.concurrency.IfMatch;
import app.keylab.shared.paging.Cursor;
import app.keylab.shared.paging.PageQuery;
import app.keylab.shared.paging.PageResult;
import app.keylab.shared.problem.ApiProblem;
import app.keylab.shared.problem.ProblemTypes;
import app.keylab.shared.security.Roles;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/**
 * Test-only endpoints. The foundation has no feature endpoints, so these
 * stand in for the ones stories will add, to exercise the ground rules
 * through the real filter chain. Lives in the test sources only.
 */
@RestController
class ProbeController {

    static final long ITEM_VERSION = 7;

    record Link(@NotBlank String website) {
    }

    record Input(@NotBlank @Size(max = 5) String username, @Valid Link links) {
    }

    record Item(int id) {
    }

    @GetMapping("/v1/probe")
    String member() {
        return "ok";
    }

    @GetMapping("/v1/admin/probe")
    String viewer() {
        return "ok";
    }

    @GetMapping("/v1/admin/probe/editor")
    @PreAuthorize("hasRole('" + Roles.EDITOR + "')")
    String editor() {
        return "ok";
    }

    @PostMapping("/v1/probe/validated")
    Input validated(@Valid @RequestBody Input input) {
        return input;
    }

    /** Items 1 to 60, in id order, by keyset. */
    @GetMapping("/v1/probe/items")
    PageResult<Item> items(PageQuery page) {
        int after = page.isFirstPage() ? 0 : Integer.parseInt(page.cursor().value(0));
        List<Item> rows = IntStream.rangeClosed(after + 1, 60).limit(page.limit()).mapToObj(Item::new).toList();
        return PageResult.of(rows, page, (item) -> Cursor.of(item.id()));
    }

    @GetMapping("/v1/probe/item")
    ResponseEntity<Item> item() {
        return ResponseEntity.ok().eTag(ETags.of(ITEM_VERSION)).body(new Item(1));
    }

    @PatchMapping("/v1/probe/item")
    ResponseEntity<Item> patch(@RequestHeader(value = "If-Match", required = false) String ifMatch) {
        IfMatch.check(ifMatch, ETags.of(ITEM_VERSION));
        return ResponseEntity.ok().eTag(ETags.of(ITEM_VERSION + 1)).body(new Item(1));
    }

    @GetMapping("/v1/probe/conflict")
    String conflict() {
        throw ApiProblem.of(ProblemTypes.CONFLICT, "missing_required_sounds", "Record the stock sounds first");
    }

    @GetMapping("/v1/probe/boom")
    String boom() {
        throw new IllegalStateException("secret internal detail: jdbc:postgresql://db/keylab");
    }
}
