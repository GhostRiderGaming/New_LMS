"use client";

import React, { useEffect, useState, useRef, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import { useDrag } from '@use-gesture/react';
import { useBellaStore } from '@/lib/bellaStore';

function VRMAvatar({ vrmUrl, isTalking, isThinking, isHappy, isListening }) {
  const [vrm, setVrm] = useState<VRM | null>(null);
  const vrmRef = useRef<VRM | null>(null);
  const { camera } = useThree();

  useEffect(() => {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    
    loader.load(
      vrmUrl,
      (gltf) => {
        const loadedVrm = gltf.userData.vrm as VRM;
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.removeUnnecessaryJoints(gltf.scene);
        
        // Face the camera properly
        loadedVrm.scene.rotation.y = Math.PI; 
        
        // Relax arms out of T-pose
        const leftArm = loadedVrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
        const rightArm = loadedVrm.humanoid?.getNormalizedBoneNode('rightUpperArm');
        if (leftArm) leftArm.rotation.z = 1.2;
        if (rightArm) rightArm.rotation.z = -1.2;
        
        // Disable frustum culling so it doesn't blink out
        loadedVrm.scene.traverse((obj) => {
          obj.frustumCulled = false;
        });

        vrmRef.current = loadedVrm;
        setVrm(loadedVrm);
      },
      (progress) => console.log('VRM Loading:', 100.0 * (progress.loaded / progress.total), '%'),
      (error) => console.error('Failed to load VRM', error)
    );
  }, [vrmUrl]);

  useFrame((state, delta) => {
    if (vrmRef.current) {
      const v = vrmRef.current;
      v.update(delta);

      // Eye / Head Tracking (Desktop Mate effect)
      if (v.lookAt) {
        const pointerTarget = new THREE.Vector3(
          state.pointer.x * 2, 
          state.pointer.y * 2 + 1.2, 
          camera.position.z 
        );
        v.lookAt.lookAt(pointerTarget);
      }

      // Natural Breathing Animation
      const spine = v.humanoid?.getNormalizedBoneNode('spine');
      if (spine) {
        spine.rotation.x = Math.sin(state.clock.elapsedTime) * 0.04;
        spine.rotation.y = Math.sin(state.clock.elapsedTime * 0.5) * 0.02;
      }
      const head = v.humanoid?.getNormalizedBoneNode('head');
      if (head) {
        // slightly tilt head naturally out-of-sync with breathing
        head.rotation.z = Math.sin(state.clock.elapsedTime * 0.8) * 0.03;
        head.rotation.y = Math.cos(state.clock.elapsedTime * 0.4) * 0.02;
      }

      // Handle Expressions based on state
      const exp = v.expressionManager;
      if (exp) {
        // Reset all common shapes
        exp.setValue('happy', 0);
        exp.setValue('joy', 0);
        exp.setValue('fun', 0);
        exp.setValue('neutral', 0);
        exp.setValue('aa', 0);
        exp.setValue('a', 0);
        
        // Random Blinking Cycle (Blink quickly every 4 seconds)
        const t = state.clock.elapsedTime % 4;
        if (t < 0.1) {
          exp.setValue('blink', 1);
        } else {
          exp.setValue('blink', 0);
        }
        
        if (isHappy) {
          exp.setValue('happy', 1);
          exp.setValue('joy', 1);
          exp.setValue('fun', 1);
        } else if (isTalking) {
          // Lip sync simulation
          const volume = Math.sin(state.clock.elapsedTime * 15) * 0.5 + 0.5;
          exp.setValue('aa', volume);
          exp.setValue('a', volume);
        } else {
          // slight smile idle
          exp.setValue('neutral', 0.8);
        }
        exp.update();
      }

      // Hand and Arm Gestures while talking
      const leftUpperArm = v.humanoid?.getNormalizedBoneNode('leftUpperArm');
      const rightUpperArm = v.humanoid?.getNormalizedBoneNode('rightUpperArm');
      const leftLowerArm = v.humanoid?.getNormalizedBoneNode('leftLowerArm');
      const rightLowerArm = v.humanoid?.getNormalizedBoneNode('rightLowerArm');

      if (isTalking) {
        // Talking gestures
        if (leftUpperArm) leftUpperArm.rotation.z = 1.0 + Math.sin(state.clock.elapsedTime * 3) * 0.1;
        if (rightUpperArm) rightUpperArm.rotation.z = -1.0 - Math.cos(state.clock.elapsedTime * 2) * 0.15;
        
        if (leftLowerArm) {
          leftLowerArm.rotation.z = Math.sin(state.clock.elapsedTime * 4) * 0.2;
          leftLowerArm.rotation.x = -0.4 + Math.sin(state.clock.elapsedTime * 2) * 0.3;
        }
        if (rightLowerArm) {
          rightLowerArm.rotation.z = -Math.cos(state.clock.elapsedTime * 3) * 0.2;
          rightLowerArm.rotation.x = -0.3 + Math.cos(state.clock.elapsedTime * 2.5) * 0.2;
        }
      } else {
        // Standard relaxed
        if (leftUpperArm) leftUpperArm.rotation.z = 1.2;
        if (rightUpperArm) rightUpperArm.rotation.z = -1.2;
        if (leftLowerArm) {
          leftLowerArm.rotation.z = 0;
          leftLowerArm.rotation.x = 0;
          leftLowerArm.rotation.y = 0;
        }
        if (rightLowerArm) {
          rightLowerArm.rotation.z = 0;
          rightLowerArm.rotation.x = 0;
        }
      }
    }
  });

  return vrm ? <primitive object={vrm.scene} position={[0, -1.2, 0]} /> : null;
}

export default function Bella3D({ isTalking, isThinking, isHappy, isListening }) {
  // Dragging logic
  const [{ x, y }, set] = useState({ x: 0, y: 0 });
  const bind = useDrag(({ offset: [ox, oy] }) => {
    set({ x: ox, y: oy });
  });

  const { show, addMessage } = useBellaStore();

  const handleManualWake = () => {
    show();
    addMessage({ role: "bella", text: "Hi! You clicked me. How can I help?" });
  };

  return (
    <div 
      {...bind()}
      className="absolute bottom-5 right-5 cursor-grab active:cursor-grabbing w-[300px] h-[400px] z-50 rounded-2xl overflow-visible pointer-events-auto"
      style={{
        transform: `translate3d(${x}px, ${y}px, 0)`,
        touchAction: 'none'
      }}
    >
      {/* 3D Viewport wrapped. Removed pointer-events-none so we can click her! */}
      <div 
        className="w-full h-full drop-shadow-2xl cursor-pointer"
        onDoubleClickCapture={handleManualWake} // Double click to wake!
      >
        <Canvas camera={{ position: [0, 0.5, 3], fov: 35 }}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[2, 2, 2]} intensity={1.5} />
          <directionalLight position={[-2, -2, 2]} intensity={0.5} />
          <Suspense fallback={null}>
            <VRMAvatar 
              vrmUrl="/bella.vrm" 
              isTalking={isTalking} 
              isThinking={isThinking} 
              isHappy={isHappy} 
              isListening={isListening} 
            />
          </Suspense>
        </Canvas>
      </div>

      {/* Decorative Aura / Effects */}
      {isListening && (
        <div className="absolute inset-0 bg-cyan-400/10 blur-xl animate-pulse rounded-full z-[-1] pointer-events-none" />
      )}
      
      {/* Speech Chat Window Floating Anchor */}
      <ChatAnchor />
    </div>
  );
}

function ChatAnchor() {
  const { messages, isVisible, hide } = useBellaStore();
  
  if (!isVisible) return null;

  return (
    <div className="absolute bottom-[420px] right-0 w-[350px] bg-black/80 backdrop-blur-md rounded-2xl border border-white/10 p-4 shadow-2xl flex flex-col gap-3">
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm font-bold text-white flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          Bella
        </span>
        <button onClick={hide} className="text-white/50 hover:text-white">✕</button>
      </div>
      <div className="max-h-[250px] overflow-y-auto flex flex-col gap-2">
        {messages.map((m, i) => (
          <div 
            key={i} 
            className={`p-2 rounded-xl text-sm ${m.role === 'user' ? 'bg-indigo-500/30 text-indigo-100 ml-auto max-w-[80%]' : 'bg-white/10 text-white mr-auto'}`}
          >
            {m.text}
          </div>
        ))}
      </div>
    </div>
  );
}
