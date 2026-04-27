# Silero TTS FastAPI — CPU base; for GPU, use an NVIDIA CUDA base image and install matching torch wheels.
FROM python:3.12-slim-bookworm

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY silero_tts ./silero_tts

ENV PYTHONPATH=/app

EXPOSE 4001

CMD ["python", "-m", "silero_tts"]
