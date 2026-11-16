package app.keylab.catalog.query;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

import app.keylab.catalog.domain.SwitchNotFound;
import app.keylab.shared.paging.Cursor;
import app.keylab.shared.paging.PageQuery;
import app.keylab.shared.paging.PageResult;

import org.springframework.stereotype.Service;

/** What the editor reads (ADM-02, US-37, US-38): every switch, drafts included. */
@Service
public class AdminSwitchQueries {

    private final LibraryRepository library;

    AdminSwitchQueries(LibraryRepository library) {
        this.library = library;
    }

    /**
     * ADM-02 list, drafts included, by name (the sound library's picker,
     * US-38). The type, status and sound filters and the bulk actions come
     * with US-36.
     *
     * @throws InvalidPageToken for a token this list did not issue
     */
    public PageResult<SwitchRow> list(String q, PageQuery page) {
        String afterName = null;
        UUID afterId = null;
        if (page.cursor() != null) {
            try {
                afterName = page.cursor().value(0);
                afterId = UUID.fromString(page.cursor().value(1));
            }
            catch (IllegalArgumentException ex) {
                throw new InvalidPageToken();
            }
        }
        String query = q == null || q.isBlank() ? null : q.strip();
        return PageResult.of(library.listByName(query, afterName, afterId, page.limit()), page,
                (sw) -> Cursor.of(sw.name().toLowerCase(Locale.ROOT), sw.id()));
    }

    /** @throws SwitchNotFound */
    public SwitchRow get(UUID id) {
        return library.byId(id).orElseThrow(SwitchNotFound::byId);
    }

    /** Ready recordings, so the publish checklist can tick the stock press and release. */
    public List<Recording> sounds(UUID switchId) {
        return library.recordings(switchId);
    }
}
