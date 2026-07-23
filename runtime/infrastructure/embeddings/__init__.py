"""
Embedding Service

Generate and query embeddings for semantic search.

DOCS: docs/infrastructure/embeddings/

Usage:
    from runtime.infrastructure.embeddings import get_embedding_service

    # Uses EMBEDDING_PROVIDER env var (default: local)
    embeddings = get_embedding_service()

    # Or specify provider explicitly
    embeddings = get_embedding_service(provider="openai")

    # Generate embedding
    vector = embeddings.embed("Aldric swore an oath")

Providers:
    - local: sentence-transformers/all-mpnet-base-v2 (768d, no API key)
    - openai: text-embedding-3-large (3072d, default) or text-embedding-3-small (1536d)

Environment:
    EMBEDDING_PROVIDER: "local" or "openai" (default: local)
    OPENAI_API_KEY: Required for openai provider
    OPENAI_EMBEDDING_MODEL: text-embedding-3-small (default) or text-embedding-3-large
"""

from .factory import get_embedding_service, EmbeddingProvider, EmbeddingConfigError
from .service import EmbeddingService
from .openai_adapter import OpenAIEmbeddingAdapter
from typing import List, Optional


def get_embedding(text: str) -> Optional[List[float]]:
    """Get embedding for text. Returns None on failure."""
    try:
        service = get_embedding_service()
        return service.embed(text)
    except Exception:
        return None


from runtime.utils import cosine_similarity  # canonical impl


__all__ = [
    'get_embedding_service',
    'EmbeddingProvider',
    'EmbeddingConfigError',
    'EmbeddingService',
    'OpenAIEmbeddingAdapter',
    'get_embedding',
    'cosine_similarity',
]
