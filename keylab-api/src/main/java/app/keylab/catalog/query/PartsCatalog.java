package app.keylab.catalog.query;

import java.util.UUID;

import app.keylab.catalog.query.PartsRepository.After;
import app.keylab.shared.paging.Cursor;
import app.keylab.shared.paging.PageQuery;
import app.keylab.shared.paging.PageResult;

import org.springframework.stereotype.Service;

/**
 * The public parts catalog besides switches (CAT-05 to CAT-08, KL2-1): what
 * the builder may pick. Published keycap sets, live mods and active case
 * parts only; the rest stays with the editors (US-40).
 */
@Service
public class PartsCatalog {

    /** Each list names itself in its cursor, so a token of one list is refused by the other. */
    static final String KEYCAP_SETS = "keycap-sets";
    static final String MODS = "mods";

    private final PartsRepository parts;

    PartsCatalog(PartsRepository parts) {
        this.parts = parts;
    }

    /** CAT-05. @throws InvalidPageToken for a token this list did not hand out */
    public PageResult<KeycapSetRow> keycapSets(PageQuery page) {
        return PageResult.of(parts.publishedKeycapSets(after(page, KEYCAP_SETS), page.limit()), page,
                (set) -> Cursor.of(KEYCAP_SETS, set.position(), set.id()));
    }

    /** CAT-06. @throws KeycapSetNotFound for a draft, a hidden set or an unknown slug */
    public KeycapSetRow keycapSet(String slug) {
        return parts.publishedKeycapSet(slug == null ? "" : slug).orElseThrow(KeycapSetNotFound::new);
    }

    /** CAT-07. @throws InvalidPageToken for a token this list did not hand out */
    public PageResult<ModRow> mods(PageQuery page) {
        return PageResult.of(parts.liveMods(after(page, MODS), page.limit()), page,
                (mod) -> Cursor.of(MODS, mod.position(), mod.id()));
    }

    /** CAT-08. */
    public CaseOptionsView caseOptions() {
        return parts.caseOptions();
    }

    private static After after(PageQuery page, String list) {
        Cursor cursor = page.cursor();
        if (cursor == null) {
            return null;
        }
        if (!list.equals(cursor.value(0))) {
            throw new InvalidPageToken();
        }
        try {
            return new After(Integer.parseInt(cursor.value(1)), UUID.fromString(cursor.value(2)));
        }
        catch (IllegalArgumentException ex) {
            throw new InvalidPageToken();
        }
    }
}
