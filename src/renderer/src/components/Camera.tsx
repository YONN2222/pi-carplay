import { useEffect, useRef, useState } from "react";
import { Typography } from "@mui/material";

const Camera = ({ settings }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraFound, setCameraFound] = useState(false);

  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: { width: 800, deviceId: settings.camera } })
      .then(stream => {
        setCameraFound(true);
        const video = videoRef.current!;
        video.srcObject = stream;
        video.play();
      })
      .catch(err => {
        console.error("error:", err);
      });
  }, [settings.camera]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        position: "relative"
      }}
    >
      <video
        ref={videoRef}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "center",
          display: "block"
      />
      {!cameraFound && (
        <Typography
          variant="subtitle1"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            color: "#fff"
          }}
        >
          No Camera Found
        </Typography>
      )}
    </div>
  );
};

export default Camera;
