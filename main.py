"""PyCharm-friendly entry point for the local student management system."""

from app import SERVER_PORT, app


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=SERVER_PORT, debug=False)
