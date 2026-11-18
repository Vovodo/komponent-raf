from urllib.parse import quote_plus
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = ""
    POSTGRES_DB: str = "komponent_raf"
    DATABASE_URL: str | None = None
    DEFAULT_PUBLIC_BASE_URL: str = "http://localhost:5173"
    COOLIFY_URL: str | None = None
    SERVICE_URL_APP: str | None = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def effective_public_base_url(self) -> str:
        # Coolify üzerinde domain bağlandığında otomatik algılar
        for candidate in (self.SERVICE_URL_APP, self.COOLIFY_URL):
            if candidate and candidate.strip():
                first_url = candidate.split(",")[0].strip().rstrip("/")
                if first_url.startswith("http"):
                    return first_url
        return self.DEFAULT_PUBLIC_BASE_URL.strip().rstrip("/")

    @property
    def sqlalchemy_database_uri(self) -> str:
        if self.DATABASE_URL:
            if self.DATABASE_URL.startswith("postgresql://"):
                return self.DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)
            return self.DATABASE_URL
        pwd = quote_plus(self.POSTGRES_PASSWORD)
        user = quote_plus(self.POSTGRES_USER)
        return f"postgresql+psycopg://{user}:{pwd}@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"

    @property
    def maintenance_conninfo(self) -> str:
        pwd = quote_plus(self.POSTGRES_PASSWORD)
        user = quote_plus(self.POSTGRES_USER)
        return f"postgresql://{user}:{pwd}@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/postgres"


settings = Settings()
