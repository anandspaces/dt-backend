# Silero TTS FastAPI — CPU base; for GPU, use an NVIDIA CUDA base image and install matching torch wheels.
FROM python:3.12-slim-bookworm

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py text_normalizer.py ./

EXPOSE 4001

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "4001"]
