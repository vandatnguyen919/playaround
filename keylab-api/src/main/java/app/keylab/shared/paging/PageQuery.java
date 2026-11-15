package app.keylab.shared.paging;

import app.keylab.shared.problem.ApiProblem;
import app.keylab.shared.problem.ProblemTypes;

/**
 * The paging part of a list request: {@code page_size} (default 24, 1 to 100)
 * and the opaque {@code page_token} from the previous page. Cursor paging
 * only: no page numbers and no totals, because feeds change while people
 * scroll (api-design-v1.md, Conventions, Lists).
 *
 * <p>A controller takes it as a plain argument (PageQueryArgumentResolver).
 *
 * @param pageSize how many items to return
 * @param cursor where the previous page stopped, or null for the first page
 */
public record PageQuery(int pageSize, Cursor cursor) {

    public static final int DEFAULT_PAGE_SIZE = 24;
    public static final int MAX_PAGE_SIZE = 100;

    public PageQuery {
        if (pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
            throw ApiProblem.of(ProblemTypes.BAD_REQUEST, "invalid_page_size",
                    "page_size must be between 1 and " + MAX_PAGE_SIZE);
        }
    }

    /** From the raw query parameters; either may be missing. */
    public static PageQuery parse(String pageSize, String pageToken) {
        int size = DEFAULT_PAGE_SIZE;
        if (pageSize != null && !pageSize.isBlank()) {
            try {
                size = Integer.parseInt(pageSize.trim());
            }
            catch (NumberFormatException ex) {
                throw ApiProblem.of(ProblemTypes.BAD_REQUEST, "invalid_page_size",
                        "page_size must be between 1 and " + MAX_PAGE_SIZE);
            }
        }
        Cursor cursor = pageToken == null || pageToken.isBlank() ? null : Cursor.decode(pageToken);
        return new PageQuery(size, cursor);
    }

    public boolean isFirstPage() {
        return cursor == null;
    }

    /** Fetch this many rows: one more than the page, to learn whether a next page exists. */
    public int limit() {
        return pageSize + 1;
    }
}
