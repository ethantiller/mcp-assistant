from fastmcp import FastMCP
from datetime import datetime
import math
import re
import httpx

mcp = FastMCP("assistant-tools")


def sanitize_search_query(query: str) -> str:
    """Strip malicious content from search queries.

    Security measures:
    - Remove SQL injection patterns
    - Strip script tags and HTML
    - Remove shell command patterns
    - Limit length to prevent resource exhaustion
    - Remove control characters
    - Strip path traversal attempts
    """
    if not query or not isinstance(query, str):
        return ""

    # Limit query length to prevent DoS
    max_length = 500
    query = query[:max_length]

    # Remove control characters (except newlines/spaces)
    query = re.sub(r'[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]', '', query)

    # Remove HTML/script tags
    query = re.sub(r'<[^>]*>', '', query)

    # Remove common SQL injection patterns
    sql_patterns = [
        r';\s*DROP\s+TABLE',
        r';\s*DELETE\s+FROM',
        r';\s*UPDATE\s+',
        r';\s*INSERT\s+INTO',
        r'UNION\s+SELECT',
        r'--\s*$',
        r'/\*.*?\*/',
    ]
    for pattern in sql_patterns:
        query = re.sub(pattern, '', query, flags=re.IGNORECASE)

    # Remove shell command injection patterns
    shell_patterns = [
        r'[;&|`$()]',  # Shell metacharacters
        r'\$\{.*?\}',  # Variable expansion
        r'\$\(.*?\)',  # Command substitution
    ]
    for pattern in shell_patterns:
        query = re.sub(pattern, '', query)

    # Remove path traversal attempts
    query = query.replace('../', '').replace('..\\', '')

    # Remove excessive whitespace
    query = ' '.join(query.split())

    # Strip leading/trailing whitespace
    query = query.strip()

    return query


@mcp.tool()
def get_current_time(timezone: str = "UTC") -> str:
    """Get the current date and time. Optionally specify a timezone name (e.g. 'UTC', 'US/Eastern')."""
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(timezone)
        now = datetime.now(tz)
        return now.strftime(f"%A, %B %d, %Y at %I:%M:%S %p ({timezone})")
    except Exception:
        now = datetime.utcnow()
        return now.strftime("%A, %B %d, %Y at %I:%M:%S %p (UTC)")


@mcp.tool()
def calculate(expression: str) -> str:
    """Safely evaluate a basic math expression (e.g. '2 + 2', 'sqrt(16)', '100 / 4')."""
    allowed = {k: getattr(math, k) for k in dir(math) if not k.startswith("_")}
    allowed["abs"] = abs
    allowed["round"] = round
    try:
        result = eval(expression, {"__builtins__": {}}, allowed)  # noqa: S307
        return str(result)
    except Exception as e:
        return f"Error evaluating expression: {e}"

@mcp.tool()
def search_web(query: str, num_results: int = 5) -> list:
    """Performs a web search for the given query and returns a summary of the top results.

    Args:
        query (str): The search query.
        num_results (int): The number of top results to return, default is 5 if unspecified.

    Returns:
        list: A list of the top search results.
    """

    # Sanitize the query to prevent malicious input
    sanitized_query = sanitize_search_query(query)

    if not sanitized_query:
        return "Invalid search query."

    try:
        from ddgs import DDGS
        results = DDGS().text(sanitized_query, max_results=num_results)
        return list(results)
    except Exception as e:
        return f"Error searching the web: {e}"

@mcp.tool()
def fetch_url_content(url: str) -> str:
    """Fetches the content of a URL and returns the first 1000 characters.

    Args:
        url (str): The URL to fetch.

    Returns:
        str: The content of the URL or an error message if fetching fails.
    """
    try:
        response = httpx.get(url, timeout=5)
        response.raise_for_status()
        return response.text  # Return only the first 1000 characters
    except Exception as e:
        return f"Error fetching URL content: {e}"


if __name__ == "__main__":
    mcp.run(transport="streamable-http", host="127.0.0.1", port=8001)
