package app.keylab.shared.paging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
import java.util.List;

import app.keylab.shared.problem.ApiProblem;
import app.keylab.shared.security.Roles;
import app.keylab.testing.IntegrationTest;
import app.keylab.testing.StubJwks;

import com.jayway.jsonpath.JsonPath;

import org.junit.jupiter.api.Test;

/** Cursor paging: page_size (default 24, max 100), page_token, { data, page }. */
class PagingTest extends IntegrationTest {

    private static final String TOKEN = StubJwks.token(Roles.USER);

    @Test
    void theDefaultPageHas24ItemsAndANextToken() throws Exception {
        getAs("/v1/probe/items", TOKEN)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(24))
            .andExpect(jsonPath("$.data[0].id").value(1))
            .andExpect(jsonPath("$.page.pageSize").value(24))
            .andExpect(jsonPath("$.page.nextPageToken").isNotEmpty());
    }

    @Test
    void followingTheTokensWalksEveryItemOnceAndEndsWithANullToken() throws Exception {
        List<Integer> seen = new ArrayList<>();
        String token = null;
        int pages = 0;
        do {
            String body = getAs("/v1/probe/items?page_size=25" + (token == null ? "" : "&page_token=" + token), TOKEN)
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            seen.addAll(JsonPath.<List<Integer>>read(body, "$.data[*].id"));
            token = JsonPath.read(body, "$.page.nextPageToken");
            pages++;
        }
        while (token != null && pages < 10);

        assertThat(pages).isEqualTo(3);
        assertThat(seen).hasSize(60).doesNotHaveDuplicates().startsWith(1).endsWith(60);
    }

    @Test
    void aPageThatEndsExactlyAtTheLastItemHasNoNextToken() throws Exception {
        getAs("/v1/probe/items?page_size=60", TOKEN)
            .andExpect(jsonPath("$.data.length()").value(60))
            .andExpect(jsonPath("$.page.nextPageToken").value(org.hamcrest.Matchers.nullValue()));
    }

    @Test
    void aPageSizeOutOfRangeIsBadRequest() throws Exception {
        for (String size : List.of("0", "101", "-1", "abc")) {
            getAs("/v1/probe/items?page_size=" + size, TOKEN)
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType("application/problem+json"))
                .andExpect(jsonPath("$.code").value("invalid_page_size"));
        }
        getAs("/v1/probe/items?page_size=100", TOKEN).andExpect(status().isOk());
    }

    @Test
    void aTokenThisApiDidNotWriteIsBadRequest() throws Exception {
        for (String token : List.of("not-a-token", "%25%25%25", "bm9wZQ")) {
            getAs("/v1/probe/items?page_token=" + token, TOKEN)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_page_token"));
        }
    }

    @Test
    void aCursorRoundTripsItsValuesAndIsUrlSafe() {
        Cursor cursor = Cursor.of("2026-11-08T10:15:30Z", "0192f0c1-6f1c-7a3e-9d57-0b6a3f6f2c11", 42);
        String token = cursor.encode();

        assertThat(token).matches("[A-Za-z0-9_-]+");
        assertThat(Cursor.decode(token)).isEqualTo(cursor);
        assertThat(Cursor.decode(token).value(2)).isEqualTo("42");
        assertThatThrownBy(() -> Cursor.decode(token).value(3)).isInstanceOf(ApiProblem.class);
    }

    @Test
    void aPageResultDropsTheExtraRowAndPointsAtTheLastOneKept() {
        PageQuery query = PageQuery.parse("2", null);
        assertThat(query.limit()).isEqualTo(3);

        PageResult<String> page = PageResult.of(List.of("a", "b", "c"), query, Cursor::of);
        assertThat(page.data()).containsExactly("a", "b");
        assertThat(Cursor.decode(page.page().nextPageToken())).isEqualTo(Cursor.of("b"));

        PageResult<String> last = PageResult.of(List.of("a", "b"), query, Cursor::of);
        assertThat(last.page().nextPageToken()).isNull();
        assertThat(last.map(String::toUpperCase).data()).containsExactly("A", "B");
    }
}
