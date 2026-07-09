# Pickleball Court Stack

A free, mobile-friendly court rotation app for pickleball open play.

## What it does

- Add players one at a time or paste a list.
- Set the number of rented courts.
- Assign doubles games to each court.
- Enter the winning team after every game.
- Create the next round with winners grouped near winners, losers near losers, and fair rest/bye rotation.
- Save the session in the organizer's browser with `localStorage`.

## Free GitHub Pages hosting

Use a public GitHub repository to keep GitHub Pages free on a GitHub Free account.

1. Create a new public repository on GitHub, for example `pickleball-court-stack`.
2. Upload these files to the repository root, or push them with Git:

```bash
git init
git add .
git commit -m "Create pickleball court stack app"
git branch -M main
git remote add origin https://github.com/YOUR-USER/pickleball-court-stack.git
git push -u origin main
```

3. In GitHub, open the repository.
4. Go to `Settings` -> `Pages`.
5. Under `Build and deployment`, choose `Deploy from a branch`.
6. Choose branch `main` and folder `/root`.
7. Save.

The app will be available at:

```text
https://YOUR-USER.github.io/pickleball-court-stack/
```

## Local use

You can open `index.html` directly in a browser. For service worker testing, use any static file server from this folder.
